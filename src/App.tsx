import { useEffect, useMemo, useReducer, useState } from 'react'

/** Driver.totalTime、Stint.duration 均为毫秒 */
type Driver = {
  id: string
  name: string
  age: number
  bloodType: string
  weight: number
  totalTime: number
  stintCount: number
}

type Stint = {
  driverId: string
  startTime: number
  endTime: number
  duration: number
}

type Config = {
  raceDurationMinutes: number
  minStints: number
  maxStintMinutes: number
  minDriveTimeMinutes: number
  maxDriveTimeMinutes: number
}

type AppState = {
  config: Config
  drivers: Driver[]
  stints: Stint[]
  currentDriverId: string
  activeStintStartTime: number | null
}

type Action =
  | { type: 'SET_CONFIG_NUMBER'; field: keyof Config; value: number }
  | { type: 'ADD_DRIVER'; driver: Driver }
  | { type: 'UPDATE_DRIVER'; id: string; patch: Partial<Pick<Driver, 'name' | 'age' | 'bloodType' | 'weight'>> }
  | { type: 'REMOVE_DRIVER'; id: string }
  | { type: 'SELECT_DRIVER'; driverId: string }
  | { type: 'START_STINT'; now: number }
  | { type: 'END_STINT'; now: number }

const STORAGE_KEY = 'kart-endurance-mvp-state'
const PERSIST_VERSION = 2
const MAX_DRIVERS = 10
const MIN_DRIVERS = 1

const defaultConfig: Config = {
  raceDurationMinutes: 180,
  minStints: 6,
  maxStintMinutes: 30,
  minDriveTimeMinutes: 45,
  maxDriveTimeMinutes: 75,
}

function createDefaultDrivers(): Driver[] {
  return [
    { id: 'driver-1', name: '车手1', age: 18, bloodType: '', weight: 65, totalTime: 0, stintCount: 0 },
    { id: 'driver-2', name: '车手2', age: 20, bloodType: '', weight: 60, totalTime: 0, stintCount: 0 },
    { id: 'driver-3', name: '车手3', age: 22, bloodType: 'A', weight: 58, totalTime: 0, stintCount: 0 },
  ]
}

const defaultState: AppState = {
  config: defaultConfig,
  drivers: createDefaultDrivers(),
  stints: [],
  currentDriverId: 'driver-1',
  activeStintStartTime: null,
}

function normalizeState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') {
    return defaultState
  }

  const obj = raw as Record<string, unknown>
  const version = typeof obj.persistVersion === 'number' ? obj.persistVersion : 1
  const maybeState = obj as Partial<AppState>
  const oldConfig = maybeState.config as Record<string, unknown> | undefined

  const config: Config = {
    raceDurationMinutes:
      Number(oldConfig?.raceDurationMinutes) || defaultConfig.raceDurationMinutes,
    minStints: Number(oldConfig?.minStints) || defaultConfig.minStints,
    maxStintMinutes: Number(oldConfig?.maxStintMinutes) || defaultConfig.maxStintMinutes,
    minDriveTimeMinutes:
      Number(oldConfig?.minDriveTimeMinutes) || defaultConfig.minDriveTimeMinutes,
    maxDriveTimeMinutes:
      Number(oldConfig?.maxDriveTimeMinutes) || defaultConfig.maxDriveTimeMinutes,
  }

  let drivers: Driver[] = []
  if (Array.isArray(maybeState.drivers) && maybeState.drivers.length > 0) {
    drivers = maybeState.drivers.map((item, index) => {
      const d = item as Partial<Driver>
      let totalTime = Number(d.totalTime) || 0
      if (version < 2) {
        totalTime *= 1000
      }
      return {
        id: String(d.id || `driver-${index + 1}`),
        name: String(d.name || `车手${index + 1}`),
        age: Number(d.age) || 0,
        bloodType: typeof d.bloodType === 'string' ? d.bloodType : '',
        weight: Number(d.weight) || 0,
        totalTime,
        stintCount: Number(d.stintCount) || 0,
      }
    })
  } else {
    drivers = createDefaultDrivers()
  }

  let stints: Stint[] = []
  if (Array.isArray(maybeState.stints)) {
    stints = maybeState.stints.map((item) => {
      const s = item as Partial<Stint>
      let duration = Number(s.duration) || 0
      if (version < 2) {
        duration *= 1000
      }
      return {
        driverId: String(s.driverId || ''),
        startTime: Number(s.startTime) || 0,
        endTime: Number(s.endTime) || 0,
        duration,
      }
    })
  }

  const ids = new Set<string>()
  drivers = drivers.map((d, i) => {
    let id = d.id
    while (ids.has(id)) {
      id = `driver-${i}-${Date.now()}`
    }
    ids.add(id)
    return { ...d, id }
  })

  const currentExists = drivers.some((d) => d.id === maybeState.currentDriverId)
  const currentDriverId = currentExists ? String(maybeState.currentDriverId) : drivers[0]?.id ?? 'driver-1'

  return {
    config,
    drivers,
    stints,
    currentDriverId,
    activeStintStartTime:
      typeof maybeState.activeStintStartTime === 'number' ? maybeState.activeStintStartTime : null,
  }
}

function createDriverId(): string {
  return `driver-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CONFIG_NUMBER':
      return {
        ...state,
        config: {
          ...state.config,
          [action.field]: action.value,
        },
      }
    case 'ADD_DRIVER': {
      if (state.drivers.length >= MAX_DRIVERS) {
        return state
      }
      return {
        ...state,
        drivers: [...state.drivers, action.driver],
      }
    }
    case 'UPDATE_DRIVER':
      return {
        ...state,
        drivers: state.drivers.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)),
      }
    case 'REMOVE_DRIVER': {
      if (state.drivers.length <= MIN_DRIVERS) {
        return state
      }
      const nextDrivers = state.drivers.filter((d) => d.id !== action.id)
      const nextCurrent =
        state.currentDriverId === action.id ? nextDrivers[0].id : state.currentDriverId
      return {
        ...state,
        drivers: nextDrivers,
        stints: state.stints.filter((s) => s.driverId !== action.id),
        currentDriverId: nextCurrent,
        activeStintStartTime:
          state.currentDriverId === action.id ? null : state.activeStintStartTime,
      }
    }
    case 'SELECT_DRIVER':
      return { ...state, currentDriverId: action.driverId }
    case 'START_STINT':
      if (state.activeStintStartTime !== null) {
        return state
      }
      return { ...state, activeStintStartTime: action.now }
    case 'END_STINT': {
      if (state.activeStintStartTime === null) {
        return state
      }
      if (!state.currentDriverId) {
        return { ...state, activeStintStartTime: null }
      }
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
        drivers: state.drivers.map((driver) =>
          driver.id === state.currentDriverId
            ? {
                ...driver,
                totalTime: driver.totalTime + duration,
                stintCount: driver.stintCount + 1,
              }
            : driver,
        ),
      }
    }
    default:
      return state
  }
}

/** 显示为 mm:ss.SSS，超过 1 小时为 h:mm:ss.SSS */
function formatDurationMs(ms: number): string {
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
  if (hour > 0) {
    return `${hour}:${mStr}:${sStr}.${msStr}`
  }
  return `${totalMin}:${sStr}.${msStr}`
}

function totalMsToMinutes(ms: number): number {
  return ms / 60000
}

type TabId = 'record' | 'manage'
type ManagePanel = 'drivers' | 'event' | null

function App() {
  const [state, dispatch] = useReducer(reducer, defaultState, () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? normalizeState(JSON.parse(saved)) : defaultState
    } catch {
      return defaultState
    }
  })
  const [tab, setTab] = useState<TabId>('record')
  const [managePanel, setManagePanel] = useState<ManagePanel>('drivers')
  const [now, setNow] = useState(Date.now())

  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formAge, setFormAge] = useState('')
  const [formBlood, setFormBlood] = useState('')
  const [formWeight, setFormWeight] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ persistVersion: PERSIST_VERSION, ...state }))
  }, [state])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 50)
    return () => window.clearInterval(timer)
  }, [])

  const activeStintMs = useMemo(() => {
    if (state.activeStintStartTime === null) {
      return 0
    }
    return Math.max(0, now - state.activeStintStartTime)
  }, [now, state.activeStintStartTime])

  const selectedDriver = state.drivers.find((driver) => driver.id === state.currentDriverId)

  const openAddForm = () => {
    setFormMode('add')
    setEditId(null)
    setFormName('')
    setFormAge('')
    setFormBlood('')
    setFormWeight('')
  }

  const openEditForm = (d: Driver) => {
    setFormMode('edit')
    setEditId(d.id)
    setFormName(d.name)
    setFormAge(String(d.age))
    setFormBlood(d.bloodType)
    setFormWeight(String(d.weight))
  }

  const closeForm = () => {
    setFormMode(null)
    setEditId(null)
  }

  const submitDriverForm = () => {
    const name = formName.trim() || '未命名车手'
    const age = Math.max(0, Math.floor(Number(formAge) || 0))
    const bloodType = formBlood.trim()
    const weight = Math.max(0, Number(formWeight) || 0)

    if (formMode === 'add') {
      if (state.drivers.length >= MAX_DRIVERS) {
        return
      }
      dispatch({
        type: 'ADD_DRIVER',
        driver: {
          id: createDriverId(),
          name,
          age,
          bloodType,
          weight,
          totalTime: 0,
          stintCount: 0,
        },
      })
    } else if (formMode === 'edit' && editId) {
      dispatch({
        type: 'UPDATE_DRIVER',
        id: editId,
        patch: { name, age, bloodType, weight },
      })
    }
    closeForm()
  }

  const removeDriver = (id: string) => {
    if (state.drivers.length <= MIN_DRIVERS) {
      window.alert(`至少保留 ${MIN_DRIVERS} 名车手`)
      return
    }
    if (!window.confirm('确定删除该车手？该车手的累计时间与棒次记录将一并删除，且无法恢复。')) {
      return
    }
    dispatch({ type: 'REMOVE_DRIVER', id })
  }

  return (
    <div className="app-shell">
      <main className="app">
        {tab === 'record' && (
          <>
            <h1>记录</h1>
            <p className="app-subtitle">卡丁车耐力赛时间管理</p>
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
                  <p className="hint">
                    共 {state.drivers.length} / {MAX_DRIVERS} 人；至少保留 {MIN_DRIVERS} 人。血型可留空。
                  </p>
                  <button type="button" className="btn-secondary full-width" onClick={openAddForm}>
                    添加车手
                  </button>

                  {formMode && (
                    <div className="driver-form card-inner">
                      <h3>{formMode === 'add' ? '新建车手' : '编辑车手'}</h3>
                      <label>
                        姓名
                        <input value={formName} onChange={(e) => setFormName(e.target.value)} />
                      </label>
                      <label>
                        年龄
                        <input
                          type="number"
                          min={0}
                          value={formAge}
                          onChange={(e) => setFormAge(e.target.value)}
                        />
                      </label>
                      <label>
                        血型（可空）
                        <input
                          value={formBlood}
                          placeholder="如 A / B / O / AB"
                          onChange={(e) => setFormBlood(e.target.value)}
                        />
                      </label>
                      <label>
                        体重 (kg)
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={formWeight}
                          onChange={(e) => setFormWeight(e.target.value)}
                        />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={closeForm}>
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
                          <span className="driver-stats">
                            累计 {formatDurationMs(d.totalTime)} · {d.stintCount} 棒
                          </span>
                        </div>
                        <div className="driver-actions">
                          <button type="button" className="btn-text" onClick={() => openEditForm(d)}>
                            编辑
                          </button>
                          <button
                            type="button"
                            className="btn-text danger"
                            onClick={() => removeDriver(d.id)}
                          >
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
                className={`accordion-head ${managePanel === 'event' ? 'open' : ''}`}
                onClick={() => setManagePanel((p) => (p === 'event' ? null : 'event'))}
              >
                <span>赛事管理</span>
                <span className="accordion-cue">{managePanel === 'event' ? '▼' : '▶'}</span>
              </button>
              {managePanel === 'event' && (
                <div className="accordion-body">
                  <div className="grid">
                    <label>
                      比赛总时长(分钟)
                      <input
                        type="number"
                        min={1}
                        value={state.config.raceDurationMinutes}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_CONFIG_NUMBER',
                            field: 'raceDurationMinutes',
                            value: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      最少棒数
                      <input
                        type="number"
                        min={0}
                        value={state.config.minStints}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_CONFIG_NUMBER',
                            field: 'minStints',
                            value: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      单棒最大时间(分钟)
                      <input
                        type="number"
                        min={1}
                        value={state.config.maxStintMinutes}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_CONFIG_NUMBER',
                            field: 'maxStintMinutes',
                            value: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      每人最少驾驶时间(分钟)
                      <input
                        type="number"
                        min={0}
                        value={state.config.minDriveTimeMinutes}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_CONFIG_NUMBER',
                            field: 'minDriveTimeMinutes',
                            value: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      每人最大驾驶时间(分钟)
                      <input
                        type="number"
                        min={1}
                        value={state.config.maxDriveTimeMinutes}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_CONFIG_NUMBER',
                            field: 'maxDriveTimeMinutes',
                            value: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {tab === 'record' && (
          <>
            <section className="card">
              <h2>驾驶记录</h2>
              <label>
                当前车手
                <select
                  value={state.currentDriverId}
                  onChange={(e) => dispatch({ type: 'SELECT_DRIVER', driverId: e.target.value })}
                >
                  {state.drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </label>

              <p className="focus">
                当前车手: <strong>{selectedDriver?.name ?? '未选择'}</strong>
              </p>
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
                  const totalMin = totalMsToMinutes(driver.totalTime)
                  const isLow = totalMin < state.config.minDriveTimeMinutes
                  const isHigh = totalMin > state.config.maxDriveTimeMinutes
                  let hint = '正常'

                  if (isLow) {
                    hint = '低于最少驾驶时间'
                  } else if (isHigh) {
                    hint = '超过最大驾驶时间'
                  }

                  return (
                    <article key={driver.id} className="stat-item">
                      <p>{driver.name}</p>
                      <p className="mono">总驾驶时间: {formatDurationMs(driver.totalTime)}</p>
                      <p>已跑棒数: {driver.stintCount}</p>
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
        <button
          type="button"
          className={tab === 'record' ? 'nav-item active' : 'nav-item'}
          onClick={() => setTab('record')}
        >
          记录
        </button>
        <button
          type="button"
          className={tab === 'manage' ? 'nav-item active' : 'nav-item'}
          onClick={() => setTab('manage')}
        >
          管理
        </button>
      </nav>
    </div>
  )
}

export default App
