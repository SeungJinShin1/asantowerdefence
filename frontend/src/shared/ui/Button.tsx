import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-amber-500 text-white shadow hover:bg-amber-600 disabled:bg-amber-200',
  secondary:
    'bg-white text-amber-800 border-2 border-amber-400 hover:bg-amber-50 disabled:opacity-50',
  ghost: 'bg-transparent text-amber-800 hover:bg-amber-100 disabled:opacity-50',
  danger: 'bg-rose-500 text-white hover:bg-rose-600 disabled:bg-rose-200',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'lg'
}

/** 아동 친화 버튼: 최소 48px, 큰 글자, 색만으로 상태를 전달하지 않도록 문구와 함께 쓴다 (docs/02 §11) */
export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const sizeClass = size === 'lg' ? 'px-10 py-4 text-2xl' : 'px-6 py-3 text-lg'
  return (
    <button
      type={type}
      className={`rounded-2xl font-bold transition disabled:cursor-not-allowed ${sizeClass} ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  )
}
