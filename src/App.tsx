import { useEffect, useMemo, useReducer, useState } from 'react'

type Driver = {
  id: string
  name: string
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
  driverCount: number
  minStints: number
  maxStintMinutes: number
  minDriveTimeMinutes: number
  maxDriveTimeMinutes: number
  driverNames: string[]
}

type AppState = {
  config: Config
  drivers: Driver[]
  stints: Stint[]
  currentDriverId: string
  activeStintStartTime: number | null
}

type Action =
  | { type: 'SET_CONFIG_NUMBER'; field: keyof Omit<Config, 'driverNames'>; value: number }
  | { type: 'SET_DRIVER_COUNT'; count: number }
  | { type: 'SET_DRIVER_NAME'; index: number; name: string }
  | { type: 'SELECT_DRIVER'; driverId: string }
  | { type: 'START_STINT'; now: number }
  | { type: 'END_STINT'; now: number }

const STORAGE_KEY = 'kart-endurance-mvp-state'

const defaultConfig: Config = {
  raceDurationMinutes: 180,
  driverCount: 3,
  minStints: 6,
  maxStintMinutes: 30,
  minDriveTimeMinutes: 45,
  maxDriveTimeMinutes: 75,
  driverNames: ['车手1', '车手2', '车手3'],
}

function buildDrivers(names: string[]): Driver[] {
  return names.map((name, index) => ({
    id: `driver-${index + 1}`,
    name,
    totalTime: 0,
    stintCount: 0,
  }))
}

const defaultState: AppState = {
  config: defaultConfig,
  drivers: buildDrivers(defaultConfig.driverNames),
  stints: [],
  currentDriverId: 'driver-1',
  activeStintStartTime: null,
}

function normalizeState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') {
    return defaultState
  }

  const maybeState = raw as Partial<AppState>
  const config = maybeState.config ?? defaultConfig
  const driverCount = Math.min(10, Math.max(2, Number(config.driverCount) || 2))
  const names = Array.from({ length: driverCount }, (_, index) => {
    const name = config.driverNames?.[index]
    return typeof name === 'string' && name.trim() ? name : `车手${index + 1}`
  })

  const fallbackDrivers = buildDrivers(names)
  const incomingDrivers = Array.isArray(maybeState.drivers) ? maybeState.drivers : fallbackDrivers
  const drivers = fallbackDrivers.map((driver, index) => {
    const found = incomingDrivers.find((item) => item?.id === driver.id) ?? incomingDrivers[index]
    return {
      id: driver.id,
      name: names[index],
      totalTime: Number(found?.totalTime) || 0,
      stintCount: Number(found?.stintCount) || 0,
    }
  })

  const currentDriverExists = drivers.some((driver) => driver.id === maybeState.currentDriverId)

  return {
    config: {
      raceDurationMinutes: Number(config.raceDurationMinutes) || defaultConfig.raceDurationMinutes,
      driverCount,
      minStints: Number(config.minStints) || defaultConfig.minStints,
      maxStintMinutes: Number(config.maxStintMinutes) || defaultConfig.maxStintMinutes,
      minDriveTimeMinutes: Number(config.minDriveTimeMinutes) || defaultConfig.minDriveTimeMinutes,
      maxDriveTimeMinutes: Number(config.maxDriveTimeMinutes) || defaultConfig.maxDriveTimeMinutes,
      driverNames: names,
    },
    drivers,
    stints: Array.isArray(maybeState.stints) ? maybeState.stints : [],
    currentDriverId: currentDriverExists ? String(maybeState.currentDriverId) : drivers[0].id,
    activeStintStartTime:
      typeof maybeState.activeStintStartTime === 'number' ? maybeState.activeStintStartTime : null,
  }
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
    case 'SET_DRIVER_COUNT': {
      const driverCount = Math.min(10, Math.max(2, action.count))
      const names = Array.from({ length: driverCount }, (_, index) => {
        return state.config.driverNames[index] ?? `车手${index + 1}`
      })
      const trimmedDrivers = buildDrivers(names).map((baseDriver) => {
        const oldDriver = state.drivers.find((driver) => driver.id === baseDriver.id)
        return oldDriver ? { ...oldDriver, name: baseDriver.name } : baseDriver
      })

      return {
        ...state,
        config: { ...state.config, driverCount, driverNames: names },
        drivers: trimmedDrivers,
        currentDriverId: trimmedDrivers.some((driver) => driver.id === state.currentDriverId)
          ? state.currentDriverId
          : trimmedDrivers[0].id,
        activeStintStartTime: null,
      }
    }
    case 'SET_DRIVER_NAME': {
      const names = [...state.config.driverNames]
      names[action.index] = action.name || `车手${action.index + 1}`
      return {
        ...state,
        config: { ...state.config, driverNames: names },
        drivers: state.drivers.map((driver, index) =>
          index === action.index ? { ...driver, name: names[action.index] } : driver,
        ),
      }
    }
    case 'SELECT_DRIVER':
      return { ...state, currentDriverId: action.driverId }
    case 'START_STINT':
      if (state.activeStintStartTime !== null) {
        return state
      }
      return { ...state, activeStintStartTime: action.now }
    case 'END_STINT':
      if (state.activeStintStartTime === null) {
        return state
      }
      if (!state.currentDriverId) {
        return { ...state, activeStintStartTime: null }
      }
      const duration = Math.max(0, Math.round((action.now - state.activeStintStartTime) / 1000))
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
    default:
      return state
  }
}

function formatSecondsToMinutes(seconds: number): string {
  return (seconds / 60).toFixed(1)
}

type TabId = 'record' | 'manage'

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
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const activeStintSeconds = useMemo(() => {
    if (state.activeStintStartTime === null) {
      return 0
    }
    return Math.max(0, Math.round((now - state.activeStintStartTime) / 1000))
  }, [now, state.activeStintStartTime])

  const selectedDriver = state.drivers.find((driver) => driver.id === state.currentDriverId)

  return (
    <div className="app-shell">
      <main className="app">
        <h1>{tab === 'record' ? '记录' : '管理'}</h1>
        <p className="app-subtitle">卡丁车耐力赛时间管理</p>

        {tab === 'manage' && (
          <section className="card">
            <h2>比赛配置</h2>
            <div className="grid">
              <label>
                比赛总时长(分钟)
                <input
                  type="number"
                  min={1}
                  value={state.config.raceDurationMinutes}
                  onChange={(event) =>
                    dispatch({
                      type: 'SET_CONFIG_NUMBER',
                      field: 'raceDurationMinutes',
                      value: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                车手数量(2-10)
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={state.config.driverCount}
                  onChange={(event) =>
                    dispatch({
                      type: 'SET_DRIVER_COUNT',
                      count: Number(event.target.value),
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
                  onChange={(event) =>
                    dispatch({
                      type: 'SET_CONFIG_NUMBER',
                      field: 'minStints',
                      value: Number(event.target.value),
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
                  onChange={(event) =>
                    dispatch({
                      type: 'SET_CONFIG_NUMBER',
                      field: 'maxStintMinutes',
                      value: Number(event.target.value),
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
                  onChange={(event) =>
                    dispatch({
                      type: 'SET_CONFIG_NUMBER',
                      field: 'minDriveTimeMinutes',
                      value: Number(event.target.value),
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
                  onChange={(event) =>
                    dispatch({
                      type: 'SET_CONFIG_NUMBER',
                      field: 'maxDriveTimeMinutes',
                      value: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>

            <div className="names">
              {state.drivers.map((driver, index) => (
                <label key={driver.id}>
                  车手{index + 1}姓名
                  <input
                    type="text"
                    value={driver.name}
                    onChange={(event) =>
                      dispatch({
                        type: 'SET_DRIVER_NAME',
                        index,
                        name: event.target.value.trim(),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        {tab === 'record' && (
          <>
      <section className="card">
        <h2>驾驶记录</h2>
        <label>
          当前车手
          <select
            value={state.currentDriverId}
            onChange={(event) => dispatch({ type: 'SELECT_DRIVER', driverId: event.target.value })}
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
        <p className="focus">
          本棒计时: <strong>{formatSecondsToMinutes(activeStintSeconds)} 分钟</strong>
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
            const totalMinutes = driver.totalTime / 60
            const isLow = totalMinutes < state.config.minDriveTimeMinutes
            const isHigh = totalMinutes > state.config.maxDriveTimeMinutes
            let hint = '正常'

            if (isLow) {
              hint = '低于最少驾驶时间'
            } else if (isHigh) {
              hint = '超过最大驾驶时间'
            }

            return (
              <article key={driver.id} className="stat-item">
                <p>{driver.name}</p>
                <p>总驾驶时间: {formatSecondsToMinutes(driver.totalTime)} 分钟</p>
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
