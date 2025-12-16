import { useState, useEffect } from 'react'
import './App.css'

interface AthleteStats {
  ytd_run_totals: {
    distance: number
    count: number
  }
}

interface Athlete {
  id: number
  firstname: string
  lastname: string
}

interface Activity {
  id: number
  start_date: string
  type: string
  distance: number
  name: string
  moving_time: number
}

interface WeekData {
  weekNumber: number
  startDate: Date
  endDate: Date
  runs: Activity[]
  totalMiles: number
  totalRuns: number
  goalMiles: number
  phase: string
}

// Activity date with workout info
interface ActivityDay {
  date: string
  count: number
  types: string[]
}

function App() {
  const [miles, setMiles] = useState<number | null>(null)
  const [runCount, setRunCount] = useState<number | null>(null)
  const [athleteName, setAthleteName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activityDays, setActivityDays] = useState<Map<string, ActivityDay>>(new Map())
  const [allActivities, setAllActivities] = useState<Activity[]>([])

  const currentYear = new Date().getFullYear()

  useEffect(() => {
    const fetchStravaData = async () => {
      const accessToken = import.meta.env.VITE_STRAVA_ACCESS_TOKEN

      if (!accessToken) {
        setError('Please add your Strava access token to .env')
        setLoading(false)
        return
      }

      try {
        // First get athlete info
        const athleteResponse = await fetch('https://www.strava.com/api/v3/athlete', {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        })

        if (!athleteResponse.ok) {
          throw new Error('Failed to fetch athlete data')
        }

        const athlete: Athlete = await athleteResponse.json()
        setAthleteName(athlete.firstname)

        // Then get athlete stats
        const statsResponse = await fetch(
          `https://www.strava.com/api/v3/athletes/${athlete.id}/stats`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        )

        if (!statsResponse.ok) {
          throw new Error('Failed to fetch stats')
        }

        const stats: AthleteStats = await statsResponse.json()
        
        // Convert meters to miles
        const distanceInMiles = stats.ytd_run_totals.distance * 0.000621371
        setMiles(distanceInMiles)
        setRunCount(stats.ytd_run_totals.count)

        // Fetch activities from Jan 1, 2025 onwards (for training tracker + calendar)
        const trainingStart = new Date(2025, 1, 1).getTime() / 1000 // Jan 1, 2025
        const now = Math.floor(Date.now() / 1000)
        
        let fetchedActivities: Activity[] = []
        let page = 1
        const perPage = 200

        // Paginate through all activities
        while (true) {
          const activitiesResponse = await fetch(
            `https://www.strava.com/api/v3/athlete/activities?after=${trainingStart}&before=${now}&page=${page}&per_page=${perPage}`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            }
          )

          if (!activitiesResponse.ok) {
            break
          }

          const activities: Activity[] = await activitiesResponse.json()
          if (activities.length === 0) break

          fetchedActivities = [...fetchedActivities, ...activities]
          if (activities.length < perPage) break
          page++
        }
        
        setAllActivities(fetchedActivities)

        // Group activities by date
        const daysMap = new Map<string, ActivityDay>()
        fetchedActivities.forEach(activity => {
          const date = activity.start_date.split('T')[0] // YYYY-MM-DD
          const existing = daysMap.get(date)
          if (existing) {
            existing.count++
            if (!existing.types.includes(activity.type)) {
              existing.types.push(activity.type)
            }
          } else {
            daysMap.set(date, {
              date,
              count: 1,
              types: [activity.type]
            })
          }
        })
        setActivityDays(daysMap)

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
      }
    }

    fetchStravaData()
  }, [currentYear])

  if (loading) {
    return (
      <div className="container">
        <div className="loader"></div>
        <p className="loading-text">Fetching your runs...</p>
      </div>
    )
  }

  if (error) {
  return (
      <div className="container">
        <div className="error-card">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="card">
        <p className="greeting">Hey {athleteName} 👋</p>
        <h1 className="year">{currentYear}</h1>
        <div className="stats">
          <div className="stat-main">
            <span className="miles-number">{miles?.toFixed(1)}</span>
            <span className="miles-label">miles run</span>
          </div>
          <div className="stat-secondary">
            <span className="run-count">{runCount}</span>
            <span className="run-label">total runs</span>
          </div>
        </div>
        <div className="strava-badge">
          powered by Strava
        </div>
      </div>

      <TrainingTracker activities={allActivities} />

      <div className="calendar-section">
        <h2 className="calendar-title">Activity Calendar</h2>
        <div className="calendar-grid">
          {Array.from({ length: 12 }, (_, monthIndex) => (
            <MonthCalendar
              key={monthIndex}
              year={currentYear}
              month={monthIndex}
              activityDays={activityDays}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface TrainingTrackerProps {
  activities: Activity[]
}

function TrainingTracker({ activities }: TrainingTrackerProps) {
  // Training period: Dec 1, 2025 to April 30, 2026
  const trainingStart = new Date(2025, 11, 1) // Dec 1, 2025 (month is 0-indexed)
  const trainingEnd = new Date(2026, 3, 30) // April 30, 2026 (month 3 = April)
  
  // Get the Monday of the week containing trainingStart
  const getWeekStart = (date: Date): Date => {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust for Monday start
    return new Date(d.setDate(diff))
  }

  // Calculate weekly goal based on training plan
  // Dec: 10-14mi, Jan: 14-18mi, Feb: 18-22mi, Mar: peak 25mi, Apr: taper
  const getWeekGoal = (weekNum: number): { goal: number; phase: string } => {
    if (weekNum <= 4) {
      // December: 10-14mi (weeks 1-4)
      return { goal: 10 + (weekNum - 1), phase: 'Base Building' }
    } else if (weekNum <= 8) {
      // January: 14-18mi (weeks 5-8)
      return { goal: 14 + (weekNum - 5), phase: 'Ramp Up' }
    } else if (weekNum <= 13) {
      // February: 18-22mi (weeks 9-13)
      return { goal: 18 + (weekNum - 9), phase: 'Building' }
    } else if (weekNum <= 17) {
      // March: ramp to peak 25mi (weeks 14-17)
      return { goal: 22 + (weekNum - 13), phase: 'Peak' }
    } else {
      // April: taper (weeks 18+)
      const taperWeek = weekNum - 17
      const taperMiles = Math.max(10, 25 - (taperWeek * 4))
      return { goal: taperMiles, phase: taperWeek >= 3 ? '🏁 Race Week' : 'Taper' }
    }
  }
  
  // Build weeks array
  const weeks: WeekData[] = []
  let weekStart = getWeekStart(trainingStart)
  let weekNumber = 1
  
  while (weekStart <= trainingEnd) {
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999) // End of Sunday, not start
    
    // Filter runs for this week
    const weekRuns = activities.filter(activity => {
      if (activity.type !== 'Run') return false
      const activityDate = new Date(activity.start_date)
      return activityDate >= weekStart && activityDate <= weekEnd
    })
    
    const totalMiles = weekRuns.reduce((sum, run) => sum + run.distance * 0.000621371, 0)
    const { goal, phase } = getWeekGoal(weekNumber)
    
    weeks.push({
      weekNumber,
      startDate: new Date(weekStart),
      endDate: new Date(weekEnd),
      runs: weekRuns,
      totalMiles,
      totalRuns: weekRuns.length,
      goalMiles: goal,
      phase
    })
    
    weekStart = new Date(weekStart)
    weekStart.setDate(weekStart.getDate() + 7)
    weekNumber++
  }

  const formatDateRange = (start: Date, end: Date): string => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[start.getMonth()]} ${start.getDate()} - ${months[end.getMonth()]} ${end.getDate()}`
  }

  const today = new Date()
  const maxGoal = Math.max(...weeks.map(w => w.goalMiles))

  // Group weeks by phase for section headers
  let currentPhase = ''

  return (
    <div className="training-section">
      <h2 className="training-title">🏃 Half Marathon Training</h2>
      <p className="training-subtitle">Dec 2025 → Apr 2026</p>
      
      <div className="weeks-container">
        {weeks.map(week => {
          const isCurrent = today >= week.startDate && today <= week.endDate
          const isFuture = week.startDate > today
          const progressPercent = Math.min((week.totalMiles / week.goalMiles) * 100, 100)
          const goalBarWidth = (week.goalMiles / maxGoal) * 100
          const hitGoal = week.totalMiles >= week.goalMiles
          const showPhaseHeader = week.phase !== currentPhase
          if (showPhaseHeader) currentPhase = week.phase
          
          return (
            <div key={week.weekNumber}>
              {showPhaseHeader && (
                <div className="phase-header">{week.phase}</div>
              )}
              <div 
                className={`week-row ${isCurrent ? 'current' : ''} ${isFuture ? 'future' : ''} ${hitGoal && !isFuture ? 'hit-goal' : ''}`}
              >
                <div className="week-label">
                  <span className="week-number">Week {week.weekNumber}</span>
                  <span className="week-dates">{formatDateRange(week.startDate, week.endDate)}</span>
                </div>
                <div className="week-bar-container" style={{ width: `${goalBarWidth}%` }}>
                  <div 
                    className={`week-bar ${hitGoal ? 'complete' : ''}`}
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                  <div className="goal-marker"></div>
                </div>
                <div className="week-stats">
                  <span className={`week-miles ${hitGoal && !isFuture ? 'hit' : ''}`}>
                    {week.totalMiles.toFixed(1)}/{week.goalMiles} mi
                  </span>
                  <span className="week-runs">{week.totalRuns} run{week.totalRuns !== 1 ? 's' : ''}</span>
                </div>
                {isCurrent && <span className="current-badge">NOW</span>}
                {hitGoal && !isFuture && <span className="goal-badge">✓</span>}
              </div>
            </div>
          )
        })}
      </div>
      
      <div className="training-totals">
        <div className="training-total-item">
          <span className="training-total-value">
            {weeks.reduce((sum, w) => sum + w.totalMiles, 0).toFixed(1)}
          </span>
          <span className="training-total-label">total miles</span>
        </div>
        <div className="training-total-item">
          <span className="training-total-value">
            {weeks.reduce((sum, w) => sum + w.totalRuns, 0)}
          </span>
          <span className="training-total-label">total runs</span>
        </div>
      </div>
    </div>
  )
}

interface MonthCalendarProps {
  year: number
  month: number
  activityDays: Map<string, ActivityDay>
}

function MonthCalendar({ year, month, activityDays }: MonthCalendarProps) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()
  
  const today = new Date()
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month
  const currentDay = today.getDate()

  // Build calendar grid
  const days: (number | null)[] = []
  
  // Empty cells before first day
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null)
  }
  
  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day)
  }

  return (
    <div className="month-calendar">
      <div className="month-name">{monthNames[month]}</div>
      <div className="day-headers">
        {dayNames.map((name, i) => (
          <div key={i} className="day-header">{name}</div>
        ))}
      </div>
      <div className="days-grid">
        {days.map((day, index) => {
          if (day === null) {
            return <div key={index} className="day-cell empty"></div>
          }
          
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const activity = activityDays.get(dateStr)
          const hasActivity = !!activity
          const isFuture = isCurrentMonth && day > currentDay
          const isToday = isCurrentMonth && day === currentDay
          
          return (
            <div
              key={index}
              className={`day-cell ${hasActivity ? 'has-activity' : ''} ${isFuture ? 'future' : ''} ${isToday ? 'today' : ''}`}
              title={hasActivity ? `${activity.count} workout${activity.count > 1 ? 's' : ''}: ${activity.types.join(', ')}` : ''}
            >
              <span className="day-number">{day}</span>
              {hasActivity && <span className="activity-dot"></span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
