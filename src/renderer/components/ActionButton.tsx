import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function ActionButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'default' | 'ghost'
    children: ReactNode
  }
) {
  const { variant = 'default', className = '', ...rest } = props
  const cls = 'btn' + (variant === 'primary' ? ' btn-primary' : '') + (variant === 'ghost' ? ' btn-ghost' : '')
  return <button type="button" className={`${cls} ${className}`.trim()} {...rest} />
}
