import { useMemo, useState } from 'react'

const TEAM_KEYS = ['A', 'B', 'C', 'D'] as const
type TeamKey = (typeof TEAM_KEYS)[number]

type TeamForm = {
  name: string
  lapsStr: string
  pitStr: string
  lapSamplesMs: number[]
  lapInputSec: string
}

function emptyTeam(): TeamForm {
  return { name: '', lapsStr: '', pitStr: '', lapSamplesMs: [], lapInputSec: '' }
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  const sign = ms < 0 ? '-' : ''
  let t = Math.floor(Math.abs(ms))
  const milli = t % 1000
  const totalSec = Math.floor(t / 1000)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hour = Math.floor(totalMin / 60)
  const msStr = String(milli).padStart(3, '0')
  const sStr = String(sec).padStart(2, '0')
  const mStr = String(min).padStart(2, '0')
  if (hour > 0) return `${sign}${hour}:${mStr}:${sStr}.${msStr}`
  return `${sign}${totalMin}:${sStr}.${msStr}`
}

function formatSecPerLap(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  return `${sec.toFixed(3)} 秒/圈`
}

function avgMs(samples: number[]): number | null {
  if (samples.length === 0) return null
  const s = samples.reduce((a, b) => a + b, 0)
  return s / samples.length
}

function minMs(samples: number[]): number | null {
  if (samples.length === 0) return null
  return Math.min(...samples)
}

function parseNonNegInt(s: string): number {
  const n = Math.floor(Number(s))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** 赛事「最少进站次数」= max(0, 最低棒数 − 1)；剩余进站 = 该项 − 已填进站次数 */
function minRequiredPitStops(minStints: number): number {
  return Math.max(0, minStints - 1)
}

function remainingPitStops(pitCount: number, minStints: number): number {
  return Math.max(0, minRequiredPitStops(minStints) - pitCount)
}

export type StrategyAnalysisProps = {
  minStints: number
  minPitTimeMinutes: number
}

type RowMetrics = {
  key: TeamKey
  name: string
  laps: number
  lapGap: number
  avgLapMs: number | null
  avgLapSec: number | null
  pitCatchUpMs: number
  pitCatchUpLaps: number | null
  theoreticalFinalLaps: number | null
  paceToCatchSec: number | null
}

export default function StrategyAnalysis({ minStints, minPitTimeMinutes }: StrategyAnalysisProps) {
  const [raceRemainMinStr, setRaceRemainMinStr] = useState('')
  const [teams, setTeams] = useState<Record<TeamKey, TeamForm>>(() => {
    const base: Record<TeamKey, TeamForm> = {
      A: { ...emptyTeam(), name: '本队' },
      B: emptyTeam(),
      C: emptyTeam(),
      D: emptyTeam(),
    }
    return base
  })

  const minPitMs = Math.max(0, minPitTimeMinutes * 60000)
  const raceRemainMs = Math.max(0, Number(raceRemainMinStr) || 0) * 60000

  const updateTeam = (key: TeamKey, patch: Partial<TeamForm>) => {
    setTeams((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const addLapSample = (key: TeamKey) => {
    const raw = teams[key].lapInputSec.trim().replace(/,/g, '.')
    const sec = Number(raw)
    if (!Number.isFinite(sec) || sec <= 0) return
    const ms = sec * 1000
    updateTeam(key, { lapSamplesMs: [...teams[key].lapSamplesMs, ms], lapInputSec: '' })
  }

  const removeLapSample = (key: TeamKey, index: number) => {
    setTeams((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        lapSamplesMs: prev[key].lapSamplesMs.filter((_, i) => i !== index),
      },
    }))
  }

  const { rows, errors } = useMemo(() => {
    const parsed = TEAM_KEYS.map((key) => {
      const f = teams[key]
      return {
        key,
        name: f.name.trim() || (key === 'A' ? '本队' : `队伍 ${key}`),
        laps: parseNonNegInt(f.lapsStr),
        pits: parseNonNegInt(f.pitStr),
        samples: f.lapSamplesMs,
      }
    })

    const lapsList = parsed.map((p) => p.laps)
    const minLaps = lapsList.length > 0 ? Math.min(...lapsList) : 0
    const teamA = parsed.find((p) => p.key === 'A')!
    const remA = remainingPitStops(teamA.pits, minStints)
    const avgAMs = avgMs(teamA.samples)

    const errs: string[] = []
    if (minStints < 1) {
      errs.push('当前赛事「最少棒数」小于 1，最少进站次数按 0 处理；请在配置中填写合理规则。')
    }

    const rowList: RowMetrics[] = parsed.map((p) => {
      const avg = avgMs(p.samples)
      const rem = remainingPitStops(p.pits, minStints)
      const lapGap = p.laps - minLaps
      const pitCatchUpMs = (rem - remA) * minPitMs
      const pitCatchUpLaps = avgAMs !== null && avgAMs > 0 ? pitCatchUpMs / avgAMs : null
      const driveRem = Math.max(0, raceRemainMs - rem * minPitMs)
      let theoreticalFinalLaps: number | null = null
      if (avg !== null && avg > 0) {
        const v = p.laps + driveRem / avg
        theoreticalFinalLaps = Number.isFinite(v) ? v : null
      }

      return {
        key: p.key,
        name: p.name,
        laps: p.laps,
        lapGap,
        avgLapMs: avg,
        avgLapSec: avg !== null ? avg / 1000 : null,
        pitCatchUpMs,
        pitCatchUpLaps,
        theoreticalFinalLaps,
        paceToCatchSec: null,
      }
    })

    const aRow = rowList.find((r) => r.key === 'A')!
    let bestPaceMs: number | null = null
    if (avgAMs !== null && avgAMs > 0 && raceRemainMs > 0) {
      const La = teamA.laps
      const driveA = Math.max(0, raceRemainMs - remA * minPitMs)
      for (const p of parsed) {
        if (p.key === 'A') continue
        const fastest = minMs(p.samples)
        const avgO = avgMs(p.samples)
        const paceMs = fastest !== null && fastest > 0 ? fastest : avgO !== null && avgO > 0 ? avgO : null
        if (paceMs === null || paceMs <= 0) continue
        const remO = remainingPitStops(p.pits, minStints)
        const driveO = Math.max(0, raceRemainMs - remO * minPitMs)
        const oppFinalLaps = p.laps + driveO / paceMs
        const gapNeed = oppFinalLaps - La
        if (gapNeed <= 0 || driveA <= 0) continue
        const tReq = driveA / gapNeed
        if (!Number.isFinite(tReq) || tReq <= 0) continue
        bestPaceMs = bestPaceMs === null ? tReq : Math.min(bestPaceMs, tReq)
      }
    }
    aRow.paceToCatchSec = bestPaceMs !== null ? bestPaceMs / 1000 : null

    rowList.sort((a, b) => b.laps - a.laps)

    return { rows: rowList, errors: errs }
  }, [teams, raceRemainMs, minStints, minPitMs])

  return (
    <div className="strategy-root">
      <section className="card strategy-input-card">
        <h2>策略 · 数据分析</h2>
        <p className="hint">
          上方录入手动数据，下方按<strong>当前圈数</strong>从高到低排列。<strong>最少进站次数</strong>取赛事「最低棒数 −
          1」（不少于 0）；各队<strong>剩余进站次数</strong> = max(0, 最少进站次数 − 您填写的进站次数)，剩余进站用时 = 剩余进站次数 ×
          最小进站时长。<strong>圈数差</strong>以四队中<strong>当前圈数最少</strong>者为参照，差值均为非负。平均圈速为已提交单圈样本的算术平均。
        </p>
        <p className="hint">
          当前赛事最少进站次数（用于策略表）：<strong>{minRequiredPitStops(minStints)}</strong>（最低棒数 {minStints} − 1）
        </p>

        <label className="strategy-field strategy-race-rem">
          比赛剩余时间（分钟）
          <input
            type="number"
            min={0}
            step={1}
            placeholder="手动填写"
            value={raceRemainMinStr}
            onChange={(e) => setRaceRemainMinStr(e.target.value)}
          />
        </label>

        <div className="strategy-team-grid">
          {TEAM_KEYS.map((key) => (
            <div key={key} className={`strategy-team-box ${key === 'A' ? 'strategy-team-own' : ''}`}>
              <div className="strategy-team-head">
                队伍 {key}
                {key === 'A' && <span className="strategy-own-badge">默认本队</span>}
              </div>
              <label>
                队名
                <input value={teams[key].name} onChange={(e) => updateTeam(key, { name: e.target.value })} placeholder={key === 'A' ? '本队' : ''} />
              </label>
              <label>
                当前圈数
                <input
                  type="number"
                  min={0}
                  value={teams[key].lapsStr}
                  onChange={(e) => updateTeam(key, { lapsStr: e.target.value })}
                />
              </label>
              <label>
                进站次数（已完成）
                <input
                  type="number"
                  min={0}
                  value={teams[key].pitStr}
                  onChange={(e) => updateTeam(key, { pitStr: e.target.value })}
                />
              </label>
              <div className="strategy-lap-add">
                <label className="strategy-lap-label">
                  当前圈速（秒/圈，可多次添加）
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    placeholder="如 95.5"
                    value={teams[key].lapInputSec}
                    onChange={(e) => updateTeam(key, { lapInputSec: e.target.value })}
                  />
                </label>
                <button type="button" className="btn-secondary strategy-add-lap-btn" onClick={() => addLapSample(key)}>
                  添加圈速
                </button>
              </div>
              {teams[key].lapSamplesMs.length > 0 ? (
                <ul className="strategy-lap-list">
                  {teams[key].lapSamplesMs.map((ms, i) => (
                    <li key={`${key}-lap-${i}`} className="strategy-lap-item">
                      <span className="mono">{(ms / 1000).toFixed(3)} 秒</span>
                      <button type="button" className="btn-text danger" onClick={() => removeLapSample(key, i)}>
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint strategy-lap-empty">暂无圈速样本</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card strategy-result-card">
        <h3>对比结果</h3>
        <p className="hint">
          <strong>圈数差</strong>：当前圈数 − 全场最低圈数（最小为 0）。<strong>进站追赶时间</strong>：（该队剩余进站次数 −
          本队剩余进站次数）× 最小进站时间。<strong>进站追赶圈数</strong>：进站追赶时间 ÷ 本队平均圈速。<strong>理论最终圈数</strong>：当前圈数 +
          max(0, 剩余赛时 − 该队剩余进站次数 × 最小进站时间) ÷ 该队平均圈速。<strong>追赶需均圈</strong>（仅本队）：对手以其实测<strong>最快单圈</strong>
          跑满剩余有效赛时，本队为追平对方理论最终圈数所需的<strong>平均</strong>圈速（取 B/C/D 最紧值）。
        </p>
        {errors.length > 0 && (
          <div className="strategy-warn">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}

        <div className="strategy-table-wrap">
          <table className="strategy-table">
            <thead>
              <tr>
                <th>队伍</th>
                <th>队名</th>
                <th>当前圈</th>
                <th>圈数差</th>
                <th>平均圈速</th>
                <th>进站追赶时间</th>
                <th>进站追赶圈数</th>
                <th>理论最终圈</th>
                <th>追赶需均圈</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.key === 'A' ? 'strategy-row-own' : ''}>
                  <td>{r.key}</td>
                  <td>{r.name}</td>
                  <td className="mono">{r.laps}</td>
                  <td className="mono">{r.lapGap}</td>
                  <td className="mono">{r.avgLapSec !== null ? `${r.avgLapSec.toFixed(3)} 秒` : '—'}</td>
                  <td className="mono">{formatDurationMs(r.pitCatchUpMs)}</td>
                  <td className="mono">
                    {r.pitCatchUpLaps !== null ? (Math.round(r.pitCatchUpLaps * 1000) / 1000).toFixed(3) : '—'}
                  </td>
                  <td className="mono">{r.theoreticalFinalLaps !== null ? (Math.round(r.theoreticalFinalLaps * 1000) / 1000).toFixed(3) : '—'}</td>
                  <td className="mono">
                    {r.key === 'A'
                      ? r.paceToCatchSec !== null
                        ? formatSecPerLap(r.paceToCatchSec)
                        : '—'
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
