export interface ProgressBarProps {
  value: number
  max: number
  label: string
  className?: string
}

export function ProgressBar({ value, max, label, className = '' }: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0
  return (
    <div className={`w-full ${className}`}>
      <div className="mb-1 flex justify-between text-sm font-semibold text-amber-900">
        <span>{label}</span>
        <span>
          {value} / {max}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-4 w-full overflow-hidden rounded-full bg-amber-100"
      >
        <div
          className="h-full rounded-full bg-amber-500 transition-all"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
