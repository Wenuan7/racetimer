import { useEffect, useMemo, useReducer, useState } from 'react'

type Driver = {
  id: string
  name: string
  age: number
  bloodType: string // 可为空
  weight: number
}

type Stint = {
  driverId: string
  startTime: number
  endTime: number
  duration: number // 毫秒
}

type EventRule = {
  id: string
  name: string
  raceDurationMinutes: number
  minStints: number
  maxStintMinutes: number
  minDriveTimeMinutes: number
  maxDriveTimeMinutes: number
}

type AppState = {
  drivers: Driver[]
  stints: Stint[]
  events: EventRule[]
  selectedEventId: string
  currentDriverId: string
  activeStintStartTime: number | null
}

type Action =
  | { type: 'ADD_DRIVER'; driver: Driver }
  | { type: 'UPDATE_DRIVER'; id: string; patch: Partial<Pick<Driver, 'name' | 'age' | 'bloodType' | 'weight'>> }
  | { type: 'REMOVE_DRIVER'; id: string }
  | { type: 'SELECT_DRIVER'; driverId: string }
  | { type: 'ADD_EVENT'; event: EventRule }
  | { type: 'UPDATE_EVENT'; id: string; patch: Partial<Omit<EventRule, 'id'>> }
  | { type: 'REMOVE_EVENT'; id: string }
  | { type: 'SELECT_EVENT'; id: string }
  | { type: 'IMPORT_CONFIG'; payload: { drivers: Driver[]; events: EventRule[]; selectedEventId: string } }
  | { type: 'START_STINT'; now: number }
  | { type: 'END_STINT'; now: number }

const STORAGE_KEY = 'kart-endurance-mvp-state'
const PERSIST_VERSION = 3
const MAX_DRIVERS = 10
const MIN_DRIVERS = 1
const MAX_EVENTS = 10
const MIN_EVENTS = 1

const defaultEvent: Omit<EventRule, 'id'> = {
  name: '默认赛事',
  raceDurationMinutes: 180,
  minStints: 6,
  maxStintMinutes: 30,
  minDriveTimeMinutes: 45,
  maxDriveTimeMinutes: 75,
}

function finiteNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function createDefaultDrivers(): Driver[] {
  return [
    { id: 'driver-1', name: '车手1', age: 18, bloodType: '', weight: 65 },
    { id: 'driver-2', name: '车手2', age: 20, bloodType: '', weight: 60 },
    { id: 'driver-3', name: '车手3', age: 22, bloodType: 'A', weight: 58 },
  ]
}

const defaultState: AppState = {
  drivers: createDefaultDrivers(),
  stints: [],
  events: [{ id: 'event-1', ...defaultEvent }],
  selectedEventId: 'event-1',
  currentDriverId: 'driver-1',
  activeStintStartTime: null,
}

function normalizeState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return defaultState
  const obj = raw as Record<string, unknown>
  const version = typeof obj.persistVersion === 'number' ? obj.persistVersion : 1

  // Drivers (兼容旧：可能带 totalTime/stintCount)
  const maybeDrivers = Array.isArray((obj as any).drivers) ? ((obj as any).drivers as unknown[]) : []
  const drivers: Driver[] =
    maybeDrivers.length > 0
      ? maybeDrivers.map((item, index) => {
          const d = item as Partial<Driver> & Record<string, unknown>
          return {
            id: String(d.id || `driver-${index + 1}`),
            name: String(d.name || `车手${index + 1}`),
            age: finiteNum(d.age, 0),
            bloodType: typeof d.bloodType === 'string' ? d.bloodType : '',
            weight: finiteNum(d.weight, 0),
          }
        })
      : createDefaultDrivers()

  const safeDrivers = drivers.length > 0 ? drivers : createDefaultDrivers()

  // Events (兼容旧：只有 config)
  let events: EventRule[] = []
  const maybeEvents = (obj as any).events
  if (Array.isArray(maybeEvents) && maybeEvents.length > 0) {
    events = maybeEvents.map((item, index) => {
      const e = item as Partial<EventRule> & Record<string, unknown>
      return {
        id: String(e.id || `event-${index + 1}`),
        name: String(e.name || `赛事${index + 1}`),
        raceDurationMinutes: finiteNum(e.raceDurationMinutes, defaultEvent.raceDurationMinutes),
        minStints: finiteNum(e.minStints, defaultEvent.minStints),
        maxStintMinutes: finiteNum(e.maxStintMinutes, defaultEvent.maxStintMinutes),
        minDriveTimeMinutes: finiteNum(e.minDriveTimeMinutes, defaultEvent.minDriveTimeMinutes),
        maxDriveTimeMinutes: finiteNum(e.maxDriveTimeMinutes, defaultEvent.maxDriveTimeMinutes),
      }
    })
  } else if ((obj as any).config && typeof (obj as any).config === 'object') {
    const cfg = (obj as any).config as Record<string, unknown>
    events = [
      {
        id: 'event-1',
        name: '默认赛事',
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

  const selectedEventIdRaw = (obj as any).selectedEventId
  const selectedEventId =
    typeof selectedEventIdRaw === 'string' && events.some((e) => e.id === selectedEventIdRaw)
      ? selectedEventIdRaw
      : events[0].id

  // stints (兼容旧版本：可能 duration 为秒)
  const maybeStints = (obj as any).stints
  const stints: Stint[] = Array.isArray(maybeStints)
    ? maybeStints.map((item) => {
        const s = item as Partial<Stint> & Record<string, unknown>
        let duration = finiteNum(s.duration, 0)
        if (version < 2) duration *= 1000
        return {
          driverId: String(s.driverId || ''),
          startTime: finiteNum(s.startTime, 0),
          endTime: finiteNum(s.endTime, 0),
          duration,
        }
      })
    : []

  const currentDriverIdRaw = (obj as any).currentDriverId
  const currentDriverId =
    typeof currentDriverIdRaw === 'string' && safeDrivers.some((d) => d.id === currentDriverIdRaw)
      ? currentDriverIdRaw
      : safeDrivers[0].id

  const active =
    typeof (obj as any).activeStintStartTime === 'number' ? ((obj as any).activeStintStartTime as number) : null

  return {
    drivers: safeDrivers,
    stints,
    events,
    selectedEventId,
    currentDriverId,
    activeStintStartTime: active,
  }
}

function safeNormalizeState(raw: unknown): AppState {
  try {
    return normalizeState(raw)
  } catch {
    return defaultState
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_DRIVER': {
      if (state.drivers.length >= MAX_DRIVERS) return state
      return { ...state, drivers: [...state.drivers, action.driver] }
    }
    case 'UPDATE_DRIVER':
      return { ...state, drivers: state.drivers.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)) }
    case 'REMOVE_DRIVER': {
      if (state.drivers.length <= MIN_DRIVERS) return state
      const nextDrivers = state.drivers.filter((d) => d.id !== action.id)
      return {
        ...state,
        drivers: nextDrivers,
        stints: state.stints.filter((s) => s.driverId !== action.id),
        currentDriverId: state.currentDriverId === action.id ? nextDrivers[0].id : state.currentDriverId,
        activeStintStartTime: state.currentDriverId === action.id ? null : state.activeStintStartTime,
      }
    }
    case 'SELECT_DRIVER':
      return { ...state, currentDriverId: action.driverId }

    case 'ADD_EVENT': {
      if (state.events.length >= MAX_EVENTS) return state
      return { ...state, events: [...state.events, action.event] }
    }
    case 'UPDATE_EVENT':
      return { ...state, events: state.events.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)) }
    case 'REMOVE_EVENT': {
      if (state.events.length <= MIN_EVENTS) return state
      const nextEvents = state.events.filter((e) => e.id !== action.id)
      return {
        ...state,
        events: nextEvents,
        selectedEventId: state.selectedEventId === action.id ? nextEvents[0].id : state.selectedEventId,
      }
    }
    case 'SELECT_EVENT':
      return { ...state, selectedEventId: action.id }

    case 'IMPORT_CONFIG': {
      const drivers = action.payload.drivers.length > 0 ? action.payload.drivers : createDefaultDrivers()
      const events = action.payload.events.length > 0 ? action.payload.events : [{ id: 'event-1', ...defaultEvent }]
      const selectedEventId = events.some((e) => e.id === action.payload.selectedEventId) ? action.payload.selectedEventId : events[0].id
      return {
        ...state,
        drivers,
        events,
        selectedEventId,
        currentDriverId: drivers[0].id,
        stints: [],
        activeStintStartTime: null,
      }
    }

    case 'START_STINT':
      if (state.activeStintStartTime !== null) return state
      return { ...state, activeStintStartTime: action.now }
    case 'END_STINT': {
      if (state.activeStintStartTime === null) return state
      const duration = Math.max(0, action.now - state.activeStintStartTime)
      return {
        ...state,
        activeStintStartTime: null,
        stints: [
          ...state.stints,
          {
            driverId: state.currentDriverId,
            startTime: state.activeStintStartTime,
            endTime: action.now,
            duration,
          },
        ],
      }
    }

    default:
      return state
  }
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '0:00.000'
  const t = Math.max(0, Math.floor(ms))
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

function totalMsToMinutes(ms: number): number {
  if (!Number.isFinite(ms)) return 0
  return ms / 60000
}

type TabId = 'record' | 'manage'
type ManagePanel = 'drivers' | 'events' | null

export default function App() {
  const [state, dispatch] = useReducer(reducer, defaultState, () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? safeNormalizeState(JSON.parse(saved)) : defaultState
    } catch {
      return defaultState
    }
  })

  const [tab, setTab] = useState<TabId>('record')
  const [managePanel, setManagePanel] = useState<ManagePanel>('drivers')
  const [now, setNow] = useState(Date.now())

  // 管理页表单状态
  const [formDriverMode, setFormDriverMode] = useState<'add' | 'edit' | null>(null)
  const [formDriverId, setFormDriverId] = useState<string | null>(null)
  const [formDriverName, setFormDriverName] = useState('')
  const [formDriverAge, setFormDriverAge] = useState('')
  const [formDriverBlood, setFormDriverBlood] = useState('')
  const [formDriverWeight, setFormDriverWeight] = useState('')

  const [formEventMode, setFormEventMode] = useState<'add' | 'edit' | null>(null)
  const [formEventId, setFormEventId] = useState<string | null>(null)
  const [formEventName, setFormEventName] = useState('')
  const [formRaceDurationMinutes, setFormRaceDurationMinutes] = useState('')
  const [formMinStints, setFormMinStints] = useState('')
  const [formMaxStintMinutes, setFormMaxStintMinutes] = useState('')
  const [formMinDriveTimeMinutes, setFormMinDriveTimeMinutes] = useState('')
  const [formMaxDriveTimeMinutes, setFormMaxDriveTimeMinutes] = useState('')

  // 配置导出/导入
  const [exportText, setExportText] = useState('')
  const [importText, setImportText] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ persistVersion: PERSIST_VERSION, ...state }))
    } catch {
      // ignore
    }
  }, [state])

  // 用于“当前进行中的本棒显示”，不是拿来做计时累加（真正时长仍用 Date.now() 差值）
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 50)
    return () => window.clearInterval(timer)
  }, [])

  const selectedEvent = useMemo(
    () => state.events.find((e) => e.id === state.selectedEventId) ?? state.events[0],
    [state.events, state.selectedEventId],
  )

  // 由 stints 动态计算累计时间与棒次数
  const driverStats = useMemo(() => {
    const totals = new Map<string, { totalTime: number; stintCount: number }>()
    for (const s of state.stints) {
      const cur = totals.get(s.driverId) ?? { totalTime: 0, stintCount: 0 }
      cur.totalTime += s.duration
      cur.stintCount += 1
      totals.set(s.driverId, cur)
    }
    return totals
  }, [state.stints])

  useEffect(() => {
    if (state.drivers.length === 0) return
    if (!state.drivers.some((d) => d.id === state.currentDriverId)) {
      dispatch({ type: 'SELECT_DRIVER', driverId: state.drivers[0].id })
    }
  }, [state.drivers, state.currentDriverId])

  const activeStintMs = useMemo(() => {
    if (state.activeStintStartTime === null) return 0
    return Math.max(0, now - state.activeStintStartTime)
  }, [now, state.activeStintStartTime])

  const selectedDriver = useMemo(
    () => state.drivers.find((d) => d.id === state.currentDriverId) ?? state.drivers[0],
    [state.drivers, state.currentDriverId],
  )

  const openAddDriver = () => {
    setFormDriverMode('add')
    setFormDriverId(null)
    setFormDriverName('')
    setFormDriverAge('')
    setFormDriverBlood('')
    setFormDriverWeight('')
  }
  const openEditDriver = (d: Driver) => {
    setFormDriverMode('edit')
    setFormDriverId(d.id)
    setFormDriverName(d.name)
    setFormDriverAge(String(d.age))
    setFormDriverBlood(d.bloodType)
    setFormDriverWeight(String(d.weight))
  }
  const closeDriverForm = () => setFormDriverMode(null)
  const submitDriverForm = () => {
    const name = formDriverName.trim() || '未命名车手'
    const age = Math.max(0, Math.floor(Number(formDriverAge) || 0))
    const bloodType = formDriverBlood.trim()
    const weight = Math.max(0, Number(formDriverWeight) || 0)

    if (formDriverMode === 'add') {
      if (state.drivers.length >= MAX_DRIVERS) return
      dispatch({
        type: 'ADD_DRIVER',
        driver: { id: createId('driver'), name, age, bloodType, weight },
      })
    } else if (formDriverMode === 'edit' && formDriverId) {
      dispatch({
        type: 'UPDATE_DRIVER',
        id: formDriverId,
        patch: { name, age, bloodType, weight },
      })
    }
    closeDriverForm()
  }

  const removeDriver = (id: string) => {
    if (state.drivers.length <= MIN_DRIVERS) {
      window.alert(`至少保留 ${MIN_DRIVERS} 名车手`)
      return
    }
    if (!window.confirm('确定删除该车手？计时记录中的该车手棒次也会被移除。')) return
    dispatch({ type: 'REMOVE_DRIVER', id })
  }

  const openAddEvent = () => {
    setFormEventMode('add')
    setFormEventId(null)
    setFormEventName('')
    setFormRaceDurationMinutes('')
    setFormMinStints('')
    setFormMaxStintMinutes('')
    setFormMinDriveTimeMinutes('')
    setFormMaxDriveTimeMinutes('')
  }
  const openEditEvent = (e: EventRule) => {
    setFormEventMode('edit')
    setFormEventId(e.id)
    setFormEventName(e.name)
    setFormRaceDurationMinutes(String(e.raceDurationMinutes))
    setFormMinStints(String(e.minStints))
    setFormMaxStintMinutes(String(e.maxStintMinutes))
    setFormMinDriveTimeMinutes(String(e.minDriveTimeMinutes))
    setFormMaxDriveTimeMinutes(String(e.maxDriveTimeMinutes))
  }
  const closeEventForm = () => setFormEventMode(null)
  const submitEventForm = () => {
    const name = formEventName.trim() || '未命名赛事'
    const raceDurationMinutes = Math.max(1, Math.floor(Number(formRaceDurationMinutes) || 0))
    const minStints = Math.max(0, Math.floor(Number(formMinStints) || 0))
    const maxStintMinutes = Math.max(1, Number(formMaxStintMinutes) || 0)
    const minDriveTimeMinutes = Math.max(0, Number(formMinDriveTimeMinutes) || 0)
    const maxDriveTimeMinutes = Math.max(1, Number(formMaxDriveTimeMinutes) || 0)

    if (formEventMode === 'add') {
      if (state.events.length >= MAX_EVENTS) return
      dispatch({
        type: 'ADD_EVENT',
        event: {
          id: createId('event'),
          name,
          raceDurationMinutes,
          minStints,
          maxStintMinutes,
          minDriveTimeMinutes,
          maxDriveTimeMinutes,
        },
      })
    } else if (formEventMode === 'edit' && formEventId) {
      dispatch({
        type: 'UPDATE_EVENT',
        id: formEventId,
        patch: { name, raceDurationMinutes, minStints, maxStintMinutes, minDriveTimeMinutes, maxDriveTimeMinutes },
      })
    }
    closeEventForm()
  }
  const removeEvent = (id: string) => {
    if (state.events.length <= MIN_EVENTS) {
      window.alert(`至少保留 ${MIN_EVENTS} 个赛事`)
      return
    }
    if (!window.confirm('确定删除该赛事？')) return
    dispatch({ type: 'REMOVE_EVENT', id })
  }

  const exportConfig = () => {
    const payload = {
      persistVersion: PERSIST_VERSION,
      drivers: state.drivers,
      events: state.events,
      selectedEventId: state.selectedEventId,
    }
    const text = JSON.stringify(payload, null, 2)
    setExportText(text)
    setImportText(text)
  }

  const importConfig = () => {
    try {
      const parsed = JSON.parse(importText)
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid')
      const driversArr = Array.isArray(parsed.drivers) ? (parsed.drivers as unknown[]) : []
      const eventsArr = Array.isArray(parsed.events) ? (parsed.events as unknown[]) : []
      if (driversArr.length === 0) throw new Error('drivers missing')
      if (eventsArr.length === 0) throw new Error('events missing')

      const drivers: Driver[] = driversArr.map((d: any, index) => ({
        id: String(d.id || `driver-${index + 1}`),
        name: String(d.name || `车手${index + 1}`),
        age: Math.max(0, Math.floor(Number(d.age) || 0)),
        bloodType: typeof d.bloodType === 'string' ? d.bloodType : '',
        weight: Math.max(0, Number(d.weight) || 0),
      }))

      const events: EventRule[] = eventsArr.map((e: any, index) => ({
        id: String(e.id || `event-${index + 1}`),
        name: String(e.name || `赛事${index + 1}`),
        raceDurationMinutes: Math.max(1, Number(e.raceDurationMinutes) || defaultEvent.raceDurationMinutes),
        minStints: Math.max(0, Math.floor(Number(e.minStints) || defaultEvent.minStints)),
        maxStintMinutes: Math.max(1, Number(e.maxStintMinutes) || defaultEvent.maxStintMinutes),
        minDriveTimeMinutes: Math.max(0, Number(e.minDriveTimeMinutes) || defaultEvent.minDriveTimeMinutes),
        maxDriveTimeMinutes: Math.max(1, Number(e.maxDriveTimeMinutes) || defaultEvent.maxDriveTimeMinutes),
      }))

      const selectedEventId = String(parsed.selectedEventId || events[0].id)
      dispatch({ type: 'IMPORT_CONFIG', payload: { drivers, events, selectedEventId } })
      window.alert('导入完成：已覆盖车手/赛事配置，并清空本次计时记录。')
    } catch (e) {
      window.alert('导入失败：请检查 JSON 格式是否正确。')
    }
  }

  return (
    <div className="app-shell">
      <main className="app">
        {tab === 'record' && (
          <>
            <h1>记录</h1>
            <p className="app-subtitle">卡丁车耐力赛时间管理</p>
            <p className="focus mono" style={{ marginTop: 8 }}>
              当前赛事：<strong>{selectedEvent?.name ?? '未选择'}</strong>
            </p>
          </>
        )}

        {tab === 'manage' && (
          <>
            <header className="manage-brand">
              <h1 className="brand-title">TFG RaceTimer</h1>
              <p className="brand-sub">赛事与车手管理</p>
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
                  <p className="hint">负责车手信息（名字 / 年龄 / 血型 / 体重）。</p>
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
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={formDriverWeight}
                          onChange={(e) => setFormDriverWeight(e.target.value)}
                        />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={closeDriverForm}>
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
                        </div>
                        <div className="driver-actions">
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
                  <p className="hint">设置赛事详情规则（本页只管理规则，计时由「记录」完成）。</p>

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
                        比赛总时长(分钟)
                        <input
                          type="number"
                          min={1}
                          value={formRaceDurationMinutes}
                          onChange={(e) => setFormRaceDurationMinutes(e.target.value)}
                        />
                      </label>
                      <label>
                        最少棒数
                        <input type="number" min={0} value={formMinStints} onChange={(e) => setFormMinStints(e.target.value)} />
                      </label>
                      <label>
                        单棒最大时间(分钟)
                        <input
                          type="number"
                          min={1}
                          value={formMaxStintMinutes}
                          onChange={(e) => setFormMaxStintMinutes(e.target.value)}
                        />
                      </label>
                      <label>
                        每人最少驾驶时间(分钟)
                        <input
                          type="number"
                          min={0}
                          value={formMinDriveTimeMinutes}
                          onChange={(e) => setFormMinDriveTimeMinutes(e.target.value)}
                        />
                      </label>
                      <label>
                        每人最大驾驶时间(分钟)
                        <input
                          type="number"
                          min={1}
                          value={formMaxDriveTimeMinutes}
                          onChange={(e) => setFormMaxDriveTimeMinutes(e.target.value)}
                        />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={closeEventForm}>
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
                            总时长 {e.raceDurationMinutes} 分钟 · 最少棒数 {e.minStints}
                          </span>
                          <span className="driver-meta">
                            单棒上限 {e.maxStintMinutes} 分钟 · 人员范围 {e.minDriveTimeMinutes}-{e.maxDriveTimeMinutes} 分钟
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

            <section className="card" style={{ marginBottom: 0 }}>
              <h2 style={{ marginBottom: 8 }}>配置导入 / 导出</h2>
              <p className="hint" style={{ marginTop: 0 }}>
                仅导入车手与赛事规则；导入会清空当前计时记录，避免数据不一致。
              </p>

              <div className="actions" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button type="button" className="btn-primary" onClick={exportConfig}>
                  导出配置
                </button>
                <button type="button" className="btn-secondary" onClick={() => setImportText(exportText || importText)}>
                  复制导入
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <label>
                  JSON
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={8}
                    style={{ width: '100%', border: '1px solid #b9c3cc', borderRadius: 10, padding: '10px 12px', fontSize: 14 }}
                  />
                </label>
              </div>

              <div className="actions" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button type="button" className="btn-secondary" onClick={() => setImportText('')}>
                  清空
                </button>
                <button type="button" className="btn-primary" onClick={importConfig}>
                  导入(覆盖)
                </button>
              </div>
            </section>
          </>
        )}

        {tab === 'record' && (
          <>
            <section className="card">
              <h2>驾驶记录</h2>
              <label>
                当前车手
                <select value={selectedDriver?.id ?? ''} onChange={(e) => dispatch({ type: 'SELECT_DRIVER', driverId: e.target.value })}>
                  {state.drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </label>

              <p className="focus mono">
                本棒计时: <strong>{formatDurationMs(activeStintMs)}</strong>
              </p>

              <div className="actions">
                <button
                  className="start"
                  disabled={state.activeStintStartTime !== null}
                  onClick={() => dispatch({ type: 'START_STINT', now: Date.now() })}
                >
                  开始驾驶
                </button>
                <button
                  className="stop"
                  disabled={state.activeStintStartTime === null}
                  onClick={() => dispatch({ type: 'END_STINT', now: Date.now() })}
                >
                  结束驾驶
                </button>
              </div>
            </section>

            <section className="card">
              <h2>统计</h2>
              <div className="stats">
                {state.drivers.map((driver) => {
                  const stat = driverStats.get(driver.id) ?? { totalTime: 0, stintCount: 0 }
                  const totalMin = totalMsToMinutes(stat.totalTime)
                  const isLow = totalMin < selectedEvent.minDriveTimeMinutes
                  const isHigh = totalMin > selectedEvent.maxDriveTimeMinutes
                  let hint = '正常'
                  if (isLow) hint = '低于最少驾驶时间'
                  else if (isHigh) hint = '超过最大驾驶时间'

                  return (
                    <article key={driver.id} className="stat-item">
                      <p>{driver.name}</p>
                      <p className="mono">总驾驶时间: {formatDurationMs(stat.totalTime)}</p>
                      <p>已跑棒数: {stat.stintCount}</p>
                      <p className={isLow || isHigh ? 'warn' : 'ok'}>{hint}</p>
                    </article>
                  )
                })}
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

