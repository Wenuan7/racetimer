import { useEffect, useMemo, useReducer, useState } from 'react'

// 车手信息：仅用于管理字段；计时统计从 stints 推导
type Driver = {
  id: string
  name: string
  age: number
  bloodType: string // 可为空
  weight: number
  onRace: boolean
}

// 驾驶棒次记录：duration 使用毫秒（Date.now() 差值）
type Stint = {
  driverId: string
  startTime: number
  endTime: number
  duration: number
  pitDuration: number | null
}

// 赛事规则
type EventRule = {
  id: string
  name: string
  teamSize: number
  raceDurationMinutes: number
  minStints: number
  maxStintMinutes: number
  minDriveTimeMinutes: number
  maxDriveTimeMinutes: number
  minPitTimeMinutes: number // 进站最小时间（分钟）
}

type AppState = {
  drivers: Driver[]
  stints: Stint[]
  events: EventRule[]
  selectedEventId: string

  // 记录页：1号位（当前驾驶车手）、2号位（替换车手）
  currentDriverId: string
  replacementDriverId: string

  // 记录页：当前是否在驾驶（stint）
  activeStintStartTime: number | null

  // 比赛开始时间（用于计算赛事剩余时间）
  raceStartTime: number | null

  // 记录页：进站换车正计时
  pitStartTime: number | null
  pitPrevDriverId: string | null
  pitNextDriverId: string | null
  pitStintStartTime: number | null

  alerts: {
    minDriveWarnedDriverIds: string[]
    maxStintWarned: boolean
    maxDriverWarnedDriverIds: string[]
  }
}

type Action =
  | { type: 'ADD_DRIVER'; driver: Driver }
  | { type: 'UPDATE_DRIVER'; id: string; patch: Partial<Pick<Driver, 'name' | 'age' | 'bloodType' | 'weight' | 'onRace'>> }
  | { type: 'REMOVE_DRIVER'; id: string }
  | { type: 'SELECT_CURRENT_DRIVER'; id: string }
  | { type: 'SELECT_REPLACEMENT_DRIVER'; id: string }

  | { type: 'ADD_EVENT'; event: EventRule }
  | { type: 'UPDATE_EVENT'; id: string; patch: Partial<Omit<EventRule, 'id'>> }
  | { type: 'REMOVE_EVENT'; id: string }
  | { type: 'SELECT_EVENT'; id: string }

  | {
      type: 'IMPORT_CONFIG'
      payload: { drivers: Driver[]; events: EventRule[]; selectedEventId: string }
    }

  | { type: 'START_STINT'; now: number }
  | { type: 'END_STINT'; now: number }
  | { type: 'RESET_RACE_RECORD' }
  | { type: 'MARK_MIN_DRIVE_WARNED'; driverId: string }
  | { type: 'MARK_MAX_STINT_WARNED' }
  | { type: 'MARK_MAX_DRIVER_WARNED'; driverId: string }
  | { type: 'START_PIT'; now: number }
  | { type: 'END_PIT'; now: number }
  | { type: 'CANCEL_PIT' }

const STORAGE_KEY = 'kart-endurance-mvp-state'
const PERSIST_VERSION = 4

const MAX_DRIVERS = 10
const MIN_DRIVERS = 1
const MAX_EVENTS = 10
const MIN_EVENTS = 1

const defaultEvent: Omit<EventRule, 'id'> = {
  name: 'CRKC',
  teamSize: 4,
  raceDurationMinutes: 180,
  minStints: 4,
  maxStintMinutes: 70,
  minDriveTimeMinutes: 45,
  maxDriveTimeMinutes: 180,
  minPitTimeMinutes: 2,
}

function presetDrivers(): Driver[] {
  return [
    { id: 'driver-1', name: 'TFG-Sino', age: 23, bloodType: 'AB+', weight: 60, onRace: true },
    { id: 'driver-2', name: 'TFG-毛哥', age: 34, bloodType: '', weight: 60, onRace: true },
    { id: 'driver-3', name: 'TFG-Gary', age: 24, bloodType: 'A+', weight: 80, onRace: true },
    { id: 'driver-4', name: 'TFG-調', age: 17, bloodType: 'O-', weight: 70, onRace: true },
    { id: 'driver-5', name: 'TFG-King', age: 15, bloodType: 'AB+', weight: 75, onRace: true },
  ]
}

function finiteNum(v: unknown, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function createDefaultDrivers(): Driver[] {
  return presetDrivers()
}

const defaultState: AppState = {
  drivers: createDefaultDrivers(),
  stints: [],
  events: [{ id: 'event-1', ...defaultEvent }],
  selectedEventId: 'event-1',
  currentDriverId: 'driver-1',
  replacementDriverId: 'driver-2',
  activeStintStartTime: null,
  raceStartTime: null,
  pitStartTime: null,
  pitPrevDriverId: null,
  pitNextDriverId: null,
  pitStintStartTime: null,

  alerts: {
    minDriveWarnedDriverIds: [],
    maxStintWarned: false,
    maxDriverWarnedDriverIds: [],
  },
}

function normalizeState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return defaultState
  const obj = raw as Record<string, unknown>
  const version = typeof obj.persistVersion === 'number' ? obj.persistVersion : 1

  // drivers
  const maybeDrivers = Array.isArray((obj as any).drivers) ? ((obj as any).drivers as unknown[]) : []
  let drivers: Driver[] =
    maybeDrivers.length > 0
      ? maybeDrivers.map((item: any, index: number) => {
          return {
            id: String(item.id || `driver-${index + 1}`),
            name: String(item.name || `车手${index + 1}`),
            age: Math.max(0, Math.floor(Number(item.age) || 0)),
            bloodType: typeof item.bloodType === 'string' ? item.bloodType : '',
            weight: Math.max(0, Number(item.weight) || 0),
            onRace: item.onRace === undefined ? true : Boolean(item.onRace),
          }
        })
      : createDefaultDrivers()

  if (drivers.length === 0) drivers = createDefaultDrivers()
  drivers = drivers.slice(0, MAX_DRIVERS)

  // events
  const maybeEvents = Array.isArray((obj as any).events) ? ((obj as any).events as unknown[]) : []
  let events: EventRule[] = []
  if (maybeEvents.length > 0) {
    events = maybeEvents.map((item: any, index: number) => {
      // 兼容旧字段：若无 minPitTimeMinutes，则用默认
      const minPitTimeMinutes =
        item.minPitTimeMinutes === undefined ? defaultEvent.minPitTimeMinutes : finiteNum(item.minPitTimeMinutes, defaultEvent.minPitTimeMinutes)
      return {
        id: String(item.id || `event-${index + 1}`),
        name: String(item.name || `赛事${index + 1}`),
        teamSize: Math.max(1, Math.floor(Number(item.teamSize) || defaultEvent.teamSize)),
        raceDurationMinutes: Math.max(1, Math.floor(Number(item.raceDurationMinutes) || defaultEvent.raceDurationMinutes)),
        minStints: Math.max(0, Math.floor(Number(item.minStints) || defaultEvent.minStints)),
        maxStintMinutes: Math.max(1, Number(item.maxStintMinutes) || defaultEvent.maxStintMinutes),
        minDriveTimeMinutes: Math.max(0, Number(item.minDriveTimeMinutes) || defaultEvent.minDriveTimeMinutes),
        maxDriveTimeMinutes: Math.max(1, Number(item.maxDriveTimeMinutes) || defaultEvent.maxDriveTimeMinutes),
        minPitTimeMinutes: Math.max(0, Number(minPitTimeMinutes) || defaultEvent.minPitTimeMinutes),
      }
    })
  } else if ((obj as any).config && typeof (obj as any).config === 'object') {
    // 兼容历史：只有单个 config 的版本
    const cfg = (obj as any).config as Record<string, unknown>
    events = [
      {
        id: 'event-1',
        ...defaultEvent,
        teamSize: finiteNum(cfg.teamSize, defaultEvent.teamSize),
        raceDurationMinutes: finiteNum(cfg.raceDurationMinutes, defaultEvent.raceDurationMinutes),
        minStints: finiteNum(cfg.minStints, defaultEvent.minStints),
        maxStintMinutes: finiteNum(cfg.maxStintMinutes, defaultEvent.maxStintMinutes),
        minDriveTimeMinutes: finiteNum(cfg.minDriveTimeMinutes, defaultEvent.minDriveTimeMinutes),
        maxDriveTimeMinutes: finiteNum(cfg.maxDriveTimeMinutes, defaultEvent.maxDriveTimeMinutes),
      },
    ]
  } else {
    events = [{ id: 'event-1', ...defaultEvent }]
  }

  if (events.length === 0) events = [{ id: 'event-1', ...defaultEvent }]
  events = events.slice(0, MAX_EVENTS)

  const selectedEventIdRaw = (obj as any).selectedEventId
  const selectedEventId =
    typeof selectedEventIdRaw === 'string' && events.some((e) => e.id === selectedEventIdRaw) ? selectedEventIdRaw : events[0].id

  // stints (兼容旧 duration=秒）
  const maybeStints = (obj as any).stints
  const stints: Stint[] = Array.isArray(maybeStints)
    ? maybeStints.map((s: any) => {
        let duration = finiteNum(s.duration, 0)
        if (version < 2) duration *= 1000
        return {
          driverId: String(s.driverId || ''),
          startTime: finiteNum(s.startTime, 0),
          endTime: finiteNum(s.endTime, 0),
          duration: Math.max(0, duration),
          pitDuration: typeof s.pitDuration === 'number' ? Math.max(0, finiteNum(s.pitDuration, 0)) : null,
        }
      })
    : []

  // current/replacement driver
  const currentDriverIdRaw = (obj as any).currentDriverId
  const currentDriverId =
    typeof currentDriverIdRaw === 'string' && drivers.some((d) => d.id === currentDriverIdRaw) ? currentDriverIdRaw : drivers[0].id

  const replacementDriverIdRaw = (obj as any).replacementDriverId
  let replacementDriverId =
    typeof replacementDriverIdRaw === 'string' && drivers.some((d) => d.id === replacementDriverIdRaw)
      ? replacementDriverIdRaw
      : drivers.find((d) => d.id !== currentDriverId)?.id ?? drivers[0].id

  // active stint & pit
  const activeStintStartTime = typeof (obj as any).activeStintStartTime === 'number' ? ((obj as any).activeStintStartTime as number) : null

  const raceStartTimeRaw = (obj as any).raceStartTime
  let raceStartTime = typeof raceStartTimeRaw === 'number' ? (raceStartTimeRaw as number) : null
  if (raceStartTime === null && stints.length > 0) {
    raceStartTime = Math.min(...stints.map((s) => s.startTime))
  }

  const pitStartTime = typeof (obj as any).pitStartTime === 'number' ? ((obj as any).pitStartTime as number) : null
  const pitPrevDriverId = typeof (obj as any).pitPrevDriverId === 'string' ? ((obj as any).pitPrevDriverId as string) : null
  const pitNextDriverId = typeof (obj as any).pitNextDriverId === 'string' ? ((obj as any).pitNextDriverId as string) : null
  const pitStintStartTime =
    typeof (obj as any).pitStintStartTime === 'number' ? Math.max(0, Math.floor((obj as any).pitStintStartTime as number)) : null

  const alertsRaw = (obj as any).alerts
  const alerts = {
    minDriveWarnedDriverIds: Array.isArray(alertsRaw?.minDriveWarnedDriverIds)
      ? (alertsRaw.minDriveWarnedDriverIds as unknown[]).map(String)
      : [],
    maxStintWarned: typeof alertsRaw?.maxStintWarned === 'boolean' ? (alertsRaw.maxStintWarned as boolean) : false,
    maxDriverWarnedDriverIds: Array.isArray(alertsRaw?.maxDriverWarnedDriverIds)
      ? (alertsRaw.maxDriverWarnedDriverIds as unknown[]).map(String)
      : [],
  }

  // 自动补齐：追加缺失的预设，并用预设覆盖已有同 ID 的车手（尤其是 onRace），避免你看到“预设不显示/上场人数不对”
  const presets = presetDrivers()
  const presetById = new Map(presets.map((d) => [d.id, d] as const))
  const presetEvent: EventRule = { id: 'event-1', ...defaultEvent }

  const mergedDrivers = drivers.map((d) => presetById.get(d.id) ?? d)
  const mergedDriverIdSet = new Set(mergedDrivers.map((d) => d.id))
  for (const pd of presets) {
    if (mergedDriverIdSet.has(pd.id)) continue
    if (mergedDrivers.length >= MAX_DRIVERS) break
    mergedDrivers.push(pd)
    mergedDriverIdSet.add(pd.id)
  }

  const mergedEvents = (() => {
    if (events.some((e) => e.id === presetEvent.id)) {
      return events.map((e) => (e.id === presetEvent.id ? presetEvent : e))
    }
    return [presetEvent, ...events].slice(0, MAX_EVENTS)
  })()

  const mergedSelectedEventId =
    typeof selectedEventId === 'string' && mergedEvents.some((e) => e.id === selectedEventId) ? selectedEventId : mergedEvents[0].id

  const mergedCurrentDriverId =
    mergedDrivers.some((d) => d.id === currentDriverId) ? currentDriverId : mergedDrivers[0].id

  const mergedReplacementDriverId =
    mergedDrivers.some((d) => d.id === replacementDriverId)
      ? replacementDriverId
      : mergedDrivers.find((d) => d.id !== mergedCurrentDriverId)?.id ?? mergedDrivers[0].id

  const activeEventForLimit =
    mergedEvents.find((e) => e.id === mergedSelectedEventId) ?? mergedEvents[0] ?? { ...defaultEvent, id: 'event-1' }

  const limitedDriversRaw = limitOnRaceByTeamSize(mergedDrivers, activeEventForLimit.teamSize)
  let raceDriversLimited = limitedDriversRaw.filter((d) => d.onRace)
  if (raceDriversLimited.length === 0 && limitedDriversRaw.length > 0) {
    limitedDriversRaw[0] = { ...limitedDriversRaw[0], onRace: true }
    raceDriversLimited = limitedDriversRaw.filter((d) => d.onRace)
  }

  const finalCurrentDriverId = raceDriversLimited.some((d) => d.id === mergedCurrentDriverId)
    ? mergedCurrentDriverId
    : raceDriversLimited[0]?.id ?? limitedDriversRaw[0]?.id ?? mergedCurrentDriverId

  let finalReplacementDriverId = raceDriversLimited.some((d) => d.id === mergedReplacementDriverId)
    ? mergedReplacementDriverId
    : raceDriversLimited[0]?.id ?? finalCurrentDriverId

  if (finalReplacementDriverId === finalCurrentDriverId && raceDriversLimited.length > 1) {
    finalReplacementDriverId = raceDriversLimited.find((d) => d.id !== finalCurrentDriverId)?.id ?? finalReplacementDriverId
  }

  return {
    drivers: limitedDriversRaw,
    stints,
    events: mergedEvents,
    selectedEventId: mergedSelectedEventId,
    currentDriverId: finalCurrentDriverId,
    replacementDriverId: finalReplacementDriverId,
    activeStintStartTime,
    raceStartTime,
    pitStartTime,
    pitPrevDriverId,
    pitNextDriverId,
    pitStintStartTime,
    alerts,
  }
}

function safeNormalizeState(raw: unknown): AppState {
  try {
    return normalizeState(raw)
  } catch {
    return defaultState
  }
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const t = Math.floor(ms)
  const milli = t % 1000
  const totalSec = Math.floor(t / 1000)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hour = Math.floor(totalMin / 60)
  const msStr = String(milli).padStart(3, '0')
  const sStr = String(sec).padStart(2, '0')
  const mStr = String(min).padStart(2, '0')
  if (hour > 0) return `${hour}:${mStr}:${sStr}.${msStr}`
  return `${totalMin}:${sStr}.${msStr}`
}

function totalMsToMinutes(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return 0
  return ms / 60000
}

function limitOnRaceByTeamSize(drivers: Driver[], teamSize: number): Driver[] {
  if (!Number.isFinite(teamSize) || teamSize <= 0) {
    // 保底：至少保留 1 个上场（第一个）
    return drivers.map((d, idx) => (idx === 0 ? { ...d, onRace: true } : { ...d, onRace: false }))
  }

  let kept = 0
  return drivers.map((d) => {
    if (!d.onRace) return d
    kept += 1
    if (kept <= teamSize) return d
    return { ...d, onRace: false }
  })
}

function applyTeamLimit(state: AppState): AppState {
  const ev = state.events.find((e) => e.id === state.selectedEventId) ?? state.events[0] ?? { id: 'event-1', ...defaultEvent, teamSize: 1 }
  const limitedDrivers = limitOnRaceByTeamSize(state.drivers, ev.teamSize)
  let raceDrivers = limitedDrivers.filter((d) => d.onRace)
  if (raceDrivers.length === 0 && limitedDrivers.length > 0) {
    raceDrivers = [{ ...limitedDrivers[0], onRace: true }, ...limitedDrivers.slice(1).map((d) => ({ ...d, onRace: false }))]
    limitedDrivers[0] = raceDrivers[0]
  }

  const currentDriverId = raceDrivers.some((d) => d.id === state.currentDriverId) ? state.currentDriverId : raceDrivers[0]?.id ?? state.currentDriverId

  let replacementDriverId = raceDrivers.some((d) => d.id === state.replacementDriverId)
    ? state.replacementDriverId
    : raceDrivers[0]?.id ?? currentDriverId

  if (replacementDriverId === currentDriverId && raceDrivers.length > 1) {
    replacementDriverId = raceDrivers.find((d) => d.id !== currentDriverId)?.id ?? replacementDriverId
  }

  return { ...state, drivers: limitedDrivers, currentDriverId, replacementDriverId }
}

function getSelectedEvent(state: AppState): EventRule {
  return state.events.find((e) => e.id === state.selectedEventId) ?? state.events[0] ?? { id: 'event-1', ...defaultEvent }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_DRIVER': {
      if (state.drivers.length >= MAX_DRIVERS) return state
      return applyTeamLimit({ ...state, drivers: [...state.drivers, action.driver] })
    }
    case 'UPDATE_DRIVER': {
      return applyTeamLimit({
        ...state,
        drivers: state.drivers.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)),
      })
    }
    case 'REMOVE_DRIVER': {
      if (state.drivers.length <= MIN_DRIVERS) return state
      const nextDrivers = state.drivers.filter((d) => d.id !== action.id)
      const nextStints = state.stints.filter((s) => s.driverId !== action.id)

      let nextCurrent = state.currentDriverId
      let nextReplacement = state.replacementDriverId
      if (nextCurrent === action.id) nextCurrent = nextDrivers[0].id
      if (nextReplacement === action.id) nextReplacement = nextDrivers.find((d) => d.id !== nextCurrent)?.id ?? nextDrivers[0].id

      // 如果正在驾驶且删除了当前车手，则清空进程
      const activeStintStartTime = state.currentDriverId === action.id ? null : state.activeStintStartTime
      const pitStartTime = state.pitPrevDriverId === action.id || state.pitNextDriverId === action.id ? null : state.pitStartTime

      return applyTeamLimit({
        ...state,
        drivers: nextDrivers,
        stints: nextStints,
        currentDriverId: nextCurrent,
        replacementDriverId: nextReplacement,
        activeStintStartTime,
        pitStartTime,
        pitPrevDriverId: pitStartTime ? state.pitPrevDriverId : null,
        pitNextDriverId: pitStartTime ? state.pitNextDriverId : null,
        pitStintStartTime: pitStartTime ? state.pitStintStartTime : null,
      })
    }

    case 'SELECT_CURRENT_DRIVER':
      return { ...state, currentDriverId: action.id }
    case 'SELECT_REPLACEMENT_DRIVER':
      return { ...state, replacementDriverId: action.id }

    case 'ADD_EVENT': {
      if (state.events.length >= MAX_EVENTS) return state
      return { ...state, events: [...state.events, action.event] }
    }
    case 'UPDATE_EVENT':
      return { ...state, events: state.events.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)) }
    case 'REMOVE_EVENT': {
      if (state.events.length <= MIN_EVENTS) return state
      const nextEvents = state.events.filter((e) => e.id !== action.id)
      const nextSelected = state.selectedEventId === action.id ? nextEvents[0].id : state.selectedEventId
      return { ...state, events: nextEvents, selectedEventId: nextSelected }
    }
    case 'SELECT_EVENT':
      return applyTeamLimit({ ...state, selectedEventId: action.id })

    case 'IMPORT_CONFIG': {
      return applyTeamLimit({
        ...state,
        ...state,
        drivers: action.payload.drivers,
        events: action.payload.events,
        selectedEventId: action.payload.selectedEventId,
        stints: [],
        activeStintStartTime: null,
        raceStartTime: null,
        pitStartTime: null,
        pitPrevDriverId: null,
        pitNextDriverId: null,
        pitStintStartTime: null,
        alerts: {
          minDriveWarnedDriverIds: [],
          maxStintWarned: false,
          maxDriverWarnedDriverIds: [],
        },
        currentDriverId: action.payload.drivers[0]?.id ?? state.currentDriverId,
        replacementDriverId: action.payload.drivers[1]?.id ?? action.payload.drivers[0]?.id ?? state.replacementDriverId,
      })
    }

    case 'START_STINT': {
      if (state.activeStintStartTime !== null) return state
      if (!state.currentDriverId) return state
      return { ...state, activeStintStartTime: action.now, raceStartTime: state.raceStartTime ?? action.now }
    }

    case 'END_STINT': {
      if (state.activeStintStartTime === null) return state
      const duration = Math.max(0, action.now - state.activeStintStartTime)
      const stint: Stint = {
        driverId: state.currentDriverId,
        startTime: state.activeStintStartTime,
        endTime: action.now,
        duration,
        pitDuration: null,
      }
      return {
        ...state,
        activeStintStartTime: null,
        stints: [...state.stints, stint],
      }
    }

    case 'RESET_RACE_RECORD': {
      return {
        ...state,
        stints: [],
        activeStintStartTime: null,
        raceStartTime: null,
        pitStartTime: null,
        pitPrevDriverId: null,
        pitNextDriverId: null,
        pitStintStartTime: null,
        alerts: {
          minDriveWarnedDriverIds: [],
          maxStintWarned: false,
          maxDriverWarnedDriverIds: [],
        },
      }
    }

    case 'MARK_MIN_DRIVE_WARNED': {
      if (state.alerts.minDriveWarnedDriverIds.includes(action.driverId)) return state
      return {
        ...state,
        alerts: {
          ...state.alerts,
          minDriveWarnedDriverIds: [...state.alerts.minDriveWarnedDriverIds, action.driverId],
        },
      }
    }
    case 'MARK_MAX_STINT_WARNED': {
      if (state.alerts.maxStintWarned) return state
      return { ...state, alerts: { ...state.alerts, maxStintWarned: true } }
    }
    case 'MARK_MAX_DRIVER_WARNED': {
      if (state.alerts.maxDriverWarnedDriverIds.includes(action.driverId)) return state
      return {
        ...state,
        alerts: {
          ...state.alerts,
          maxDriverWarnedDriverIds: [...state.alerts.maxDriverWarnedDriverIds, action.driverId],
        },
      }
    }

    case 'START_PIT': {
      if (state.activeStintStartTime === null) return state
      if (state.pitStartTime !== null) return state
      const now = action.now

      return {
        ...state,
        activeStintStartTime: null,
        pitStartTime: now,
        pitPrevDriverId: state.currentDriverId,
        pitNextDriverId: state.replacementDriverId,
        pitStintStartTime: state.activeStintStartTime,
      }
    }

    case 'END_PIT': {
      if (state.pitStartTime === null) return state
      if (!state.pitPrevDriverId || !state.pitNextDriverId) return state
      if (state.pitStintStartTime === null) return state
      const end = action.now
      const pitDuration = Math.max(0, end - state.pitStartTime)
      const duration = Math.max(0, state.pitStartTime - state.pitStintStartTime)
      const stint: Stint = {
        driverId: state.pitPrevDriverId,
        startTime: state.pitStintStartTime,
        endTime: state.pitStartTime,
        duration,
        pitDuration,
      }
      return {
        ...state,
        stints: [...state.stints, stint],
        currentDriverId: state.pitNextDriverId,
        replacementDriverId: state.pitPrevDriverId,
        activeStintStartTime: end,
        pitStartTime: null,
        pitPrevDriverId: null,
        pitNextDriverId: null,
        pitStintStartTime: null,
      }
    }
    case 'CANCEL_PIT': {
      if (state.pitStartTime === null) return state
      if (!state.pitPrevDriverId || state.pitStintStartTime === null) return state
      return {
        ...state,
        activeStintStartTime: state.pitStintStartTime,
        pitStartTime: null,
        pitPrevDriverId: null,
        pitNextDriverId: null,
        pitStintStartTime: null,
      }
    }

    default:
      return state
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, defaultState, () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? safeNormalizeState(JSON.parse(saved)) : defaultState
    } catch {
      return defaultState
    }
  })

  const [tab, setTab] = useState<'record' | 'manage'>('record')
  const [managePanel, setManagePanel] = useState<'drivers' | 'events' | null>('drivers')
  const [now, setNow] = useState(Date.now())

  // 仅用于刷新 UI 倒计时/毫秒显示；真正计时仍用 Date.now() 差值
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 50)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ persistVersion: PERSIST_VERSION, ...state }))
    } catch {
      // ignore
    }
  }, [state])

  const selectedEvent = useMemo(() => getSelectedEvent(state), [state])

  const activeStintMs = useMemo(() => {
    if (state.activeStintStartTime === null) return 0
    return Math.max(0, now - state.activeStintStartTime)
  }, [now, state.activeStintStartTime])

  const raceElapsedMs = useMemo(() => {
    if (state.raceStartTime === null) return 0
    return Math.max(0, now - state.raceStartTime)
  }, [now, state.raceStartTime])

  const raceRemainingMs = useMemo(() => {
    const total = Math.max(0, Math.floor(selectedEvent.raceDurationMinutes * 60000))
    return Math.max(0, total - raceElapsedMs)
  }, [selectedEvent.raceDurationMinutes, raceElapsedMs])

  const currentDriver = useMemo(() => state.drivers.find((d) => d.id === state.currentDriverId) ?? null, [state.drivers, state.currentDriverId])
  const replacementDriver = useMemo(
    () => state.drivers.find((d) => d.id === state.replacementDriverId) ?? null,
    [state.drivers, state.replacementDriverId],
  )
  const raceDrivers = useMemo(() => state.drivers.filter((d) => d.onRace), [state.drivers])

  const teamSizeLimit = selectedEvent.teamSize

  const setDriverOnRace = (driverId: string, nextOnRace: boolean) => {
    if (!nextOnRace) {
      dispatch({ type: 'UPDATE_DRIVER', id: driverId, patch: { onRace: false } })
      return
    }
    const othersOnRace = state.drivers.filter((d) => d.onRace && d.id !== driverId).length
    if (othersOnRace >= teamSizeLimit) {
      window.alert('上场人数已满')
      return
    }
    dispatch({ type: 'UPDATE_DRIVER', id: driverId, patch: { onRace: true } })
  }

  // 统计：由 stints 聚合
  const driverStats = useMemo(() => {
    const totals = new Map<string, { totalTime: number; stintCount: number; stints: { duration: number; pitDuration: number | null }[] }>()
    for (const s of state.stints) {
      const cur = totals.get(s.driverId) ?? { totalTime: 0, stintCount: 0, stints: [] }
      cur.totalTime += s.duration
      cur.stintCount += 1
      cur.stints.push({ duration: s.duration, pitDuration: s.pitDuration })
      totals.set(s.driverId, cur)
    }
    return totals
  }, [state.stints])

  const currentDriverTotalMs = useMemo(() => {
    const base = driverStats.get(state.currentDriverId)?.totalTime ?? 0
    return base + (state.activeStintStartTime !== null ? activeStintMs : 0)
  }, [driverStats, state.currentDriverId, state.activeStintStartTime, activeStintMs])

  // 弹窗告警（只提示一次）
  useEffect(() => {
    // 1) 赛事剩余时间不足以满足某选手最低驾驶 + 10 分钟缓冲
    if (state.raceStartTime !== null) {
      const bufferMs = 10 * 60000
      const minNeedByDriver = raceDrivers
        .map((d) => {
          const done = driverStats.get(d.id)?.totalTime ?? 0
          const need = Math.max(0, selectedEvent.minDriveTimeMinutes * 60000 - done)
          return { driverId: d.id, name: d.name, needMs: need }
        })
        .filter((x) => x.needMs > 0)
      for (const item of minNeedByDriver) {
        if (state.alerts.minDriveWarnedDriverIds.includes(item.driverId)) continue
        if (raceRemainingMs <= item.needMs + bufferMs) {
          window.alert(`提醒：赛事剩余时间不足。\n${item.name} 还差最低驾驶 ${Math.ceil(item.needMs / 60000)} 分钟，剩余时间已接近（+10分钟缓冲）。`)
          dispatch({ type: 'MARK_MIN_DRIVE_WARNED', driverId: item.driverId })
          break
        }
      }
    }

    // 2) 单棒最高时间剩余 10 分钟
    if (state.activeStintStartTime !== null) {
      const remainMs = selectedEvent.maxStintMinutes * 60000 - activeStintMs
      if (!state.alerts.maxStintWarned && remainMs > 0 && remainMs <= 10 * 60000) {
        window.alert('提醒：距离单棒最高时间仅剩 10 分钟。')
        dispatch({ type: 'MARK_MAX_STINT_WARNED' })
      }
    }

    // 3) 个人最高时间剩余 10 分钟（当前驾驶车手）
    if (currentDriver && currentDriver.onRace) {
      const remainMs = selectedEvent.maxDriveTimeMinutes * 60000 - currentDriverTotalMs
      if (!state.alerts.maxDriverWarnedDriverIds.includes(currentDriver.id) && remainMs > 0 && remainMs <= 10 * 60000) {
        window.alert(`提醒：${currentDriver.name} 距离个人最高驾驶时间仅剩 10 分钟。`)
        dispatch({ type: 'MARK_MAX_DRIVER_WARNED', driverId: currentDriver.id })
      }
    }
  }, [
    now,
    state.raceStartTime,
    raceRemainingMs,
    raceDrivers,
    driverStats,
    selectedEvent.minDriveTimeMinutes,
    selectedEvent.maxStintMinutes,
    selectedEvent.maxDriveTimeMinutes,
    state.activeStintStartTime,
    activeStintMs,
    currentDriver,
    currentDriverTotalMs,
    state.alerts.minDriveWarnedDriverIds,
    state.alerts.maxStintWarned,
    state.alerts.maxDriverWarnedDriverIds,
  ])

  useEffect(() => {
    if (raceDrivers.length === 0) return
    if (!raceDrivers.some((d) => d.id === state.currentDriverId)) {
      dispatch({ type: 'SELECT_CURRENT_DRIVER', id: raceDrivers[0].id })
    }
    if (!raceDrivers.some((d) => d.id === state.replacementDriverId)) {
      const next = raceDrivers.find((d) => d.id !== raceDrivers[0].id) ?? raceDrivers[0]
      dispatch({ type: 'SELECT_REPLACEMENT_DRIVER', id: next.id })
    }
  }, [raceDrivers, state.currentDriverId, state.replacementDriverId])

  // ————— 管理页表单状态 —————
  const [formDriverMode, setFormDriverMode] = useState<'add' | 'edit' | null>(null)
  const [formDriverId, setFormDriverId] = useState<string | null>(null)
  const [formDriverName, setFormDriverName] = useState('')
  const [formDriverAge, setFormDriverAge] = useState('')
  const [formDriverBlood, setFormDriverBlood] = useState('')
  const [formDriverWeight, setFormDriverWeight] = useState('')
  const [formDriverOnRace, setFormDriverOnRace] = useState(true)

  const [formEventMode, setFormEventMode] = useState<'add' | 'edit' | null>(null)
  const [formEventId, setFormEventId] = useState<string | null>(null)
  const [formEventName, setFormEventName] = useState('')
  const [formTeamSize, setFormTeamSize] = useState('')
  const [formRaceDurationMinutes, setFormRaceDurationMinutes] = useState('')
  const [formMinStints, setFormMinStints] = useState('')
  const [formMaxStintMinutes, setFormMaxStintMinutes] = useState('')
  const [formMinDriveTimeMinutes, setFormMinDriveTimeMinutes] = useState('')
  const [formMaxDriveTimeMinutes, setFormMaxDriveTimeMinutes] = useState('')
  const [formMinPitTimeMinutes, setFormMinPitTimeMinutes] = useState('')

  // ————— 导出/导入文件 —————
  const [fileInputKey, setFileInputKey] = useState(0)

  const openAddDriver = () => {
    setFormDriverMode('add')
    setFormDriverId(null)
    setFormDriverName('')
    setFormDriverAge('')
    setFormDriverBlood('')
    setFormDriverWeight('')
    setFormDriverOnRace(true)
  }
  const openEditDriver = (d: Driver) => {
    setFormDriverMode('edit')
    setFormDriverId(d.id)
    setFormDriverName(d.name)
    setFormDriverAge(String(d.age))
    setFormDriverBlood(d.bloodType)
    setFormDriverWeight(String(d.weight))
    setFormDriverOnRace(d.onRace)
  }
  const submitDriverForm = () => {
    const name = formDriverName.trim() || '未命名车手'
    const age = Math.max(0, Math.floor(Number(formDriverAge) || 0))
    const bloodType = formDriverBlood.trim()
    const weight = Math.max(0, Number(formDriverWeight) || 0)
    const onRace = formDriverOnRace
    if (formDriverMode === 'add') {
      if (state.drivers.length >= MAX_DRIVERS) return
      dispatch({ type: 'ADD_DRIVER', driver: { id: createId('driver'), name, age, bloodType, weight, onRace } })
    } else if (formDriverMode === 'edit' && formDriverId) {
      dispatch({ type: 'UPDATE_DRIVER', id: formDriverId, patch: { name, age, bloodType, weight, onRace } })
    }
    setFormDriverMode(null)
    setFormDriverId(null)
  }
  const removeDriver = (id: string) => {
    if (!window.confirm('确定删除该车手？计时记录中的该车手棒次也会被移除。')) return
    dispatch({ type: 'REMOVE_DRIVER', id })
  }

  const openAddEvent = () => {
    setFormEventMode('add')
    setFormEventId(null)
    setFormEventName('')
    setFormTeamSize('')
    setFormRaceDurationMinutes('')
    setFormMinStints('')
    setFormMaxStintMinutes('')
    setFormMinDriveTimeMinutes('')
    setFormMaxDriveTimeMinutes('')
    setFormMinPitTimeMinutes('')
  }
  const openEditEvent = (e: EventRule) => {
    setFormEventMode('edit')
    setFormEventId(e.id)
    setFormEventName(e.name)
    setFormTeamSize(String(e.teamSize))
    setFormRaceDurationMinutes(String(e.raceDurationMinutes))
    setFormMinStints(String(e.minStints))
    setFormMaxStintMinutes(String(e.maxStintMinutes))
    setFormMinDriveTimeMinutes(String(e.minDriveTimeMinutes))
    setFormMaxDriveTimeMinutes(String(e.maxDriveTimeMinutes))
    setFormMinPitTimeMinutes(String(e.minPitTimeMinutes))
  }
  const submitEventForm = () => {
    const name = formEventName.trim() || '未命名赛事'
    const teamSize = Math.max(1, Math.floor(Number(formTeamSize) || defaultEvent.teamSize))
    const raceDurationMinutes = Math.max(1, Math.floor(Number(formRaceDurationMinutes) || defaultEvent.raceDurationMinutes))
    const minStints = Math.max(0, Math.floor(Number(formMinStints) || defaultEvent.minStints))
    const maxStintMinutes = Math.max(1, Number(formMaxStintMinutes) || defaultEvent.maxStintMinutes)
    const minDriveTimeMinutes = Math.max(0, Number(formMinDriveTimeMinutes) || defaultEvent.minDriveTimeMinutes)
    const maxDriveTimeMinutes = Math.max(1, Number(formMaxDriveTimeMinutes) || defaultEvent.maxDriveTimeMinutes)
    const minPitTimeMinutes = Math.max(0, Number(formMinPitTimeMinutes) || defaultEvent.minPitTimeMinutes)

    if (formEventMode === 'add') {
      if (state.events.length >= MAX_EVENTS) return
      dispatch({
        type: 'ADD_EVENT',
        event: {
          id: createId('event'),
          name,
          teamSize,
          raceDurationMinutes,
          minStints,
          maxStintMinutes,
          minDriveTimeMinutes,
          maxDriveTimeMinutes,
          minPitTimeMinutes,
        },
      })
    } else if (formEventMode === 'edit' && formEventId) {
      dispatch({
        type: 'UPDATE_EVENT',
        id: formEventId,
        patch: {
          name,
          teamSize,
          raceDurationMinutes,
          minStints,
          maxStintMinutes,
          minDriveTimeMinutes,
          maxDriveTimeMinutes,
          minPitTimeMinutes,
        },
      })
    }
    setFormEventMode(null)
    setFormEventId(null)
  }
  const removeEvent = (id: string) => {
    if (!window.confirm('确定删除该赛事？')) return
    dispatch({ type: 'REMOVE_EVENT', id })
  }

  const exportConfigAsFile = () => {
    const payload = { persistVersion: PERSIST_VERSION, drivers: state.drivers, events: state.events, selectedEventId: state.selectedEventId }
    const text = JSON.stringify(payload, null, 2)
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'racetimer-config.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const importConfigFromFile = async (file: File) => {
    const text = await file.text()
    const parsed = JSON.parse(text)
    const driversArr = Array.isArray(parsed.drivers) ? (parsed.drivers as any[]) : []
    const eventsArr = Array.isArray(parsed.events) ? (parsed.events as any[]) : []
    if (driversArr.length === 0 || eventsArr.length === 0) throw new Error('invalid payload')

    const drivers: Driver[] = driversArr.map((d: any, index: number) => ({
      id: String(d.id || `driver-${index + 1}`),
      name: String(d.name || `车手${index + 1}`),
      age: Math.max(0, Math.floor(Number(d.age) || 0)),
      bloodType: typeof d.bloodType === 'string' ? d.bloodType : '',
      weight: Math.max(0, Number(d.weight) || 0),
      onRace: d.onRace === undefined ? true : Boolean(d.onRace),
    }))

    const events: EventRule[] = eventsArr.map((e: any, index: number) => {
      const minPitTimeMinutes = e.minPitTimeMinutes === undefined ? defaultEvent.minPitTimeMinutes : finiteNum(e.minPitTimeMinutes, defaultEvent.minPitTimeMinutes)
      return {
        id: String(e.id || `event-${index + 1}`),
        name: String(e.name || `赛事${index + 1}`),
        teamSize: Math.max(1, Math.floor(Number(e.teamSize) || defaultEvent.teamSize)),
        raceDurationMinutes: Math.max(1, Math.floor(Number(e.raceDurationMinutes) || defaultEvent.raceDurationMinutes)),
        minStints: Math.max(0, Math.floor(Number(e.minStints) || defaultEvent.minStints)),
        maxStintMinutes: Math.max(1, Number(e.maxStintMinutes) || defaultEvent.maxStintMinutes),
        minDriveTimeMinutes: Math.max(0, Number(e.minDriveTimeMinutes) || defaultEvent.minDriveTimeMinutes),
        maxDriveTimeMinutes: Math.max(1, Number(e.maxDriveTimeMinutes) || defaultEvent.maxDriveTimeMinutes),
        minPitTimeMinutes: Math.max(0, Number(minPitTimeMinutes) || defaultEvent.minPitTimeMinutes),
      }
    })

    const selectedEventId = String(parsed.selectedEventId || (events[0] && events[0].id) || 'event-1')
    dispatch({ type: 'IMPORT_CONFIG', payload: { drivers, events, selectedEventId } })
    window.alert('导入完成：车手/赛事配置已覆盖，计时记录已清空。')
  }

  const pitIsActive = state.pitStartTime !== null
  const pitElapsedMs = pitIsActive ? Math.max(0, now - (state.pitStartTime as number)) : 0
  const minPitMs = Math.max(0, Math.floor(selectedEvent.minPitTimeMinutes * 60000))
  const canEndPit = pitIsActive && pitElapsedMs >= minPitMs

  const canStart = state.activeStintStartTime === null && !pitIsActive && raceDrivers.length > 0
  const canEnd = state.activeStintStartTime !== null && !pitIsActive
  const canPit =
    state.activeStintStartTime !== null &&
    !pitIsActive &&
    state.replacementDriverId !== state.currentDriverId &&
    raceDrivers.some((d) => d.id === state.replacementDriverId)

  const confirmTwice = (first: string, second: string) => {
    return window.confirm(first) && window.confirm(second)
  }

  const onEndStint = () => {
    if (!canEnd) return
    const ok = confirmTwice('确认结束驾驶？', '二次确认：确认后将重置该场比赛记录，继续吗？')
    if (!ok) return
    dispatch({ type: 'RESET_RACE_RECORD' })
  }

  const onCancelPit = () => {
    if (!pitIsActive) return
    const ok = window.confirm('确认取消进站？取消后不记录本次进站，也不新增棒次。')
    if (!ok) return
    dispatch({ type: 'CANCEL_PIT' })
  }

  return (
    <div className="app-shell">
      <main className="app">
        {tab === 'record' && (
          <>
            <header className="manage-brand">
              <h1 className="brand-title">TFG RaceTimer</h1>
            </header>
          </>
        )}

        {tab === 'manage' && (
          <>
            <header className="manage-brand">
              <h1 className="brand-title">TFG RaceTimer</h1>
            </header>

            <section className="card manage-accordion">
              <button
                type="button"
                className={`accordion-head ${managePanel === 'drivers' ? 'open' : ''}`}
                onClick={() => setManagePanel((p) => (p === 'drivers' ? null : 'drivers'))}
              >
                <span>车手管理</span>
                <span className="accordion-cue">{managePanel === 'drivers' ? '▼' : '▶'}</span>
              </button>
              {managePanel === 'drivers' && (
                <div className="accordion-body">
                  <p className="hint">仅维护车手信息：名字 / 年龄 / 血型（可空）/ 体重。</p>
                  <button type="button" className="btn-secondary full-width" onClick={openAddDriver}>
                    添加车手
                  </button>

                  {formDriverMode && (
                    <div className="driver-form card-inner">
                      <h3>{formDriverMode === 'add' ? '新建车手' : '编辑车手'}</h3>
                      <label>
                        姓名
                        <input value={formDriverName} onChange={(e) => setFormDriverName(e.target.value)} />
                      </label>
                      <label>
                        年龄
                        <input type="number" min={0} value={formDriverAge} onChange={(e) => setFormDriverAge(e.target.value)} />
                      </label>
                      <label>
                        血型（可空）
                        <input value={formDriverBlood} placeholder="如 A / B / O / AB" onChange={(e) => setFormDriverBlood(e.target.value)} />
                      </label>
                      <label>
                        体重 (kg)
                        <input type="number" min={0} step={0.1} value={formDriverWeight} onChange={(e) => setFormDriverWeight(e.target.value)} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={formDriverOnRace}
                          onChange={(e) => {
                            const checked = e.target.checked
                            if (!checked) {
                              setFormDriverOnRace(false)
                              return
                            }
                            if (formDriverMode === 'edit' && formDriverId) {
                              const excluding = state.drivers.filter((d) => d.onRace && d.id !== formDriverId).length
                              if (excluding >= teamSizeLimit) {
                                window.alert('上场人数已满')
                                setFormDriverOnRace(false)
                                return
                              }
                            } else {
                              // add 模式：新车手尚未加入 onRace 统计
                              if (raceDrivers.length >= teamSizeLimit) {
                                window.alert('上场人数已满')
                                setFormDriverOnRace(false)
                                return
                              }
                            }
                            setFormDriverOnRace(true)
                          }}
                          style={{ width: 18, height: 18 }}
                        />
                        本场上场
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setFormDriverMode(null)}>
                          取消
                        </button>
                        <button type="button" className="btn-primary" onClick={submitDriverForm}>
                          保存
                        </button>
                      </div>
                    </div>
                  )}

                  <ul className="driver-list">
                    {state.drivers.map((d) => (
                      <li key={d.id} className="driver-row">
                        <div className="driver-info">
                          <strong>{d.name}</strong>
                          <span className="driver-meta">
                            {d.age} 岁 · {d.weight} kg
                            {d.bloodType ? ` · 血型 ${d.bloodType}` : ''}
                          </span>
                          <span className="driver-meta">{d.onRace ? '已勾选上场' : '未勾选上场'}</span>
                        </div>
                        <div className="driver-actions">
                          <button
                            type="button"
                            className="btn-text"
                            onClick={() => setDriverOnRace(d.id, !d.onRace)}
                          >
                            {d.onRace ? '取消上场' : '设为上场'}
                          </button>
                          <button type="button" className="btn-text" onClick={() => openEditDriver(d)}>
                            编辑
                          </button>
                          <button type="button" className="btn-text danger" onClick={() => removeDriver(d.id)}>
                            删除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="card manage-accordion">
              <button
                type="button"
                className={`accordion-head ${managePanel === 'events' ? 'open' : ''}`}
                onClick={() => setManagePanel((p) => (p === 'events' ? null : 'events'))}
              >
                <span>赛事管理</span>
                <span className="accordion-cue">{managePanel === 'events' ? '▼' : '▶'}</span>
              </button>
              {managePanel === 'events' && (
                <div className="accordion-body">
                  <p className="hint">管理赛事规则（配置支持导出/导入）。</p>
                  <button type="button" className="btn-secondary full-width" onClick={openAddEvent}>
                    添加赛事
                  </button>

                  {formEventMode && (
                    <div className="driver-form card-inner">
                      <h3>{formEventMode === 'add' ? '新建赛事' : '编辑赛事'}</h3>
                      <label>
                        赛事名称
                        <input value={formEventName} onChange={(e) => setFormEventName(e.target.value)} />
                      </label>
                      <label>
                        上场人数
                        <input type="number" min={1} value={formTeamSize} onChange={(e) => setFormTeamSize(e.target.value)} />
                      </label>
                      <label>
                        比赛总时长(分钟)
                        <input type="number" min={1} value={formRaceDurationMinutes} onChange={(e) => setFormRaceDurationMinutes(e.target.value)} />
                      </label>
                      <label>
                        最少棒数
                        <input type="number" min={0} value={formMinStints} onChange={(e) => setFormMinStints(e.target.value)} />
                      </label>
                      <label>
                        单棒最大时间(分钟)
                        <input type="number" min={1} value={formMaxStintMinutes} onChange={(e) => setFormMaxStintMinutes(e.target.value)} />
                      </label>
                      <label>
                        每人最少驾驶时间(分钟)
                        <input type="number" min={0} value={formMinDriveTimeMinutes} onChange={(e) => setFormMinDriveTimeMinutes(e.target.value)} />
                      </label>
                      <label>
                        每人最大驾驶时间(分钟)
                        <input type="number" min={1} value={formMaxDriveTimeMinutes} onChange={(e) => setFormMaxDriveTimeMinutes(e.target.value)} />
                      </label>
                      <label>
                        进站最小时间(分钟)
                        <input type="number" min={0} value={formMinPitTimeMinutes} onChange={(e) => setFormMinPitTimeMinutes(e.target.value)} />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setFormEventMode(null)}>
                          取消
                        </button>
                        <button type="button" className="btn-primary" onClick={submitEventForm}>
                          保存
                        </button>
                      </div>
                    </div>
                  )}

                  <ul className="driver-list">
                    {state.events.map((e) => (
                      <li key={e.id} className="driver-row">
                        <div className="driver-info">
                          <strong>{e.name}</strong>
                          <span className="driver-meta">
                            {e.teamSize} 人 · {e.raceDurationMinutes} 分钟 · 最少棒数 {e.minStints}
                            <br />
                            单棒上限 {e.maxStintMinutes} 分钟 · 人员阈值 {e.minDriveTimeMinutes}-{e.maxDriveTimeMinutes} 分钟
                            <br />
                            进站最小 {e.minPitTimeMinutes} 分钟
                          </span>
                        </div>
                        <div className="driver-actions">
                          <button type="button" className="btn-text" onClick={() => dispatch({ type: 'SELECT_EVENT', id: e.id })}>
                            {state.selectedEventId === e.id ? '当前' : '使用'}
                          </button>
                          <button type="button" className="btn-text" onClick={() => openEditEvent(e)}>
                            编辑
                          </button>
                          <button type="button" className="btn-text danger" onClick={() => removeEvent(e.id)}>
                            删除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="card">
              <h2 style={{ marginBottom: 8 }}>配置导出 / 导入（文件）</h2>
              <p className="hint" style={{ marginTop: 0 }}>
                导出为 JSON 文件；导入将覆盖车手与赛事规则，并清空计时记录。
              </p>

              <div className="actions">
                <button type="button" className="btn-primary" onClick={exportConfigAsFile}>
                  导出配置文件
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setFileInputKey((k) => k + 1)
                    const input = document.getElementById('configFileInput') as HTMLInputElement | null
                    input?.click()
                  }}
                >
                  选择导入文件
                </button>
              </div>

              <input
                key={fileInputKey}
                id="configFileInput"
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try {
                    await importConfigFromFile(file)
                  } catch {
                    window.alert('导入失败：请确认 JSON 格式正确。')
                  }
                }}
              />
            </section>
          </>
        )}

        {tab === 'record' && (
          <>
            <section className="card">
              <div className="section-gap" />

              <div className="event-config">
                <div className="race-config-title">赛事配置：{selectedEvent.name}</div>
                <div className="event-config-grid">
                  <div>上场人数：{selectedEvent.teamSize} 人</div>
                  <div>总时长：{selectedEvent.raceDurationMinutes} 分钟</div>
                  <div>最少棒数：{selectedEvent.minStints} </div>
                  <div>单棒最大：{selectedEvent.maxStintMinutes} 分钟</div>
                  <div>每人最少驾驶：{selectedEvent.minDriveTimeMinutes} 分钟</div>
                  <div>每人最多驾驶：{selectedEvent.maxDriveTimeMinutes} 分钟</div>
                  <div>进站最小时间：{selectedEvent.minPitTimeMinutes} 分钟</div>
                </div>
              </div>

              <div className="pit-slots">
                <div className="pit-slot">
                  <div className="pit-slot-title">1号位（当前驾驶车手）</div>
                  {!pitIsActive && state.activeStintStartTime === null && raceDrivers.length > 0 ? (
                    <select value={state.currentDriverId} onChange={(e) => dispatch({ type: 'SELECT_CURRENT_DRIVER', id: e.target.value })}>
                      {raceDrivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="pit-slot-value">
                      {currentDriver?.onRace ? currentDriver.name : '未选择上场车手'}
                      {pitIsActive && <span className="pit-state"> · 进站中</span>}
                    </div>
                  )}
                </div>

                <div className="pit-slot">
                  <div className="pit-slot-title">2号位（替换车手）</div>
                  {!pitIsActive && raceDrivers.length > 0 ? (
                    <select
                      value={state.replacementDriverId}
                      onChange={(e) => dispatch({ type: 'SELECT_REPLACEMENT_DRIVER', id: e.target.value })}
                    >
                      {raceDrivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : !pitIsActive ? (
                    <div className="pit-slot-value">暂无上场车手</div>
                  ) : (
                    <div className="pit-slot-value">{replacementDriver ? replacementDriver.name : '未选择'}</div>
                  )}
                </div>
              </div>

              <div className="timer-row">
                <div className="timer-card">
                  <div className="timer-label">
                    本棒计时
                    {pitIsActive && <span className="timer-badge">（进站中）</span>}
                  </div>
                  <div className="timer-value mono">{formatDurationMs(activeStintMs)}</div>
                </div>

                <div className="timer-card">
                  <div className="timer-label">进站计时</div>
                  <div className="timer-value mono">{pitIsActive ? formatDurationMs(pitElapsedMs) : '—'}</div>
                </div>
              </div>

              <div className="actions">
                {pitIsActive ? (
                  <>
                    <button type="button" className="stop" onClick={onCancelPit}>
                      取消进站
                    </button>
                    <button type="button" className="start" disabled={!canEndPit} onClick={() => dispatch({ type: 'END_PIT', now: Date.now() })}>
                      {canEndPit ? '结束进站' : `至少进站${selectedEvent.minPitTimeMinutes}分钟`}
                    </button>
                  </>
                ) : state.activeStintStartTime === null ? (
                  <>
                    <button
                      type="button"
                      className="start"
                      disabled={!canStart}
                      onClick={() => dispatch({ type: 'START_STINT', now: Date.now() })}
                    >
                      开始驾驶
                    </button>
                    <button type="button" className="start" disabled>
                      进站
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="stop"
                      disabled={!canEnd}
                      onClick={onEndStint}
                    >
                      结束驾驶
                    </button>
                    <button type="button" className="start" disabled={!canPit} onClick={() => dispatch({ type: 'START_PIT', now: Date.now() })}>
                      进站
                    </button>
                  </>
                )}
              </div>
            </section>

            <section className="card">
              <h2>统计</h2>
              <div className="stats-overview">
                <div className="stat-item">
                  <p>本场总时间</p>
                  <p className="mono">{formatDurationMs(raceElapsedMs)}</p>
                </div>
                <div className="stat-item">
                  <p>本场总进站次数</p>
                  <p className="mono">{state.stints.filter((s) => s.pitDuration !== null).length}</p>
                </div>
              </div>

              <div className="warn-board">
                {state.activeStintStartTime !== null && (
                  (() => {
                    const remain = selectedEvent.maxStintMinutes * 60000 - activeStintMs
                    if (remain > 0 && remain <= 10 * 60000) {
                      return <div className="warn-line">⚠ 距离单棒最高时间仅剩 10 分钟</div>
                    }
                    return null
                  })()
                )}
                {currentDriver && currentDriver.onRace && (
                  (() => {
                    const remain = selectedEvent.maxDriveTimeMinutes * 60000 - currentDriverTotalMs
                    if (remain > 0 && remain <= 10 * 60000) {
                      return <div className="warn-line">⚠ {currentDriver.name} 距离个人最高驾驶时间仅剩 10 分钟</div>
                    }
                    return null
                  })()
                )}
              </div>

              <div className="stats">
                {raceDrivers.map((d) => {
                  const stat = driverStats.get(d.id) ?? { totalTime: 0, stintCount: 0, stints: [] as { duration: number; pitDuration: number | null }[] }
                  const totalMin = totalMsToMinutes(stat.totalTime)
                  const isLow = totalMin < selectedEvent.minDriveTimeMinutes
                  const isHigh = totalMin > selectedEvent.maxDriveTimeMinutes
                  const hint = isLow ? '低于最少驾驶时间' : isHigh ? '超过最大驾驶时间' : '正常'

                  return (
                    <article key={d.id} className="stat-item">
                      <p>{d.name}</p>
                      <p className="mono">总驾驶时间: {formatDurationMs(stat.totalTime)}</p>
                      <p>已跑棒数: {stat.stintCount}</p>
                      <p className={isLow || isHigh ? 'warn' : 'ok'}>{hint}</p>
                      <div className="stint-list">
                        {stat.stints.length === 0 ? (
                          <p className="hint">暂无棒次记录</p>
                        ) : (
                          stat.stints.map((item, idx) => (
                            <div key={`${d.id}-stint-${idx}`} className="stint-row">
                              <div className="stint-left">
                                <div className="stint-index">第 {idx + 1} 棒</div>
                                <div className="stint-driver">进站时长：{item.pitDuration === null ? '无' : formatDurationMs(item.pitDuration)}</div>
                              </div>
                              <div className="stint-duration mono">{formatDurationMs(item.duration)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  )
                })}
                {raceDrivers.length === 0 && <p className="hint">未勾选上场车手，暂无统计。</p>}
              </div>
            </section>
          </>
        )}
      </main>

      <nav className="bottom-nav" aria-label="主导航">
        <button type="button" className={tab === 'record' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('record')}>
          记录
        </button>
        <button type="button" className={tab === 'manage' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('manage')}>
          管理
        </button>
      </nav>
    </div>
  )
}

