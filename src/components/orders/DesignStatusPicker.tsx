import { ChevronDown } from 'lucide-react'
import { DESIGN_STATUS_CONFIG, designLabel, selectableDesignStatuses, type DesignStatus } from '@/components/orders/orderModel'

/**
 * A custom or partner order's design status as a tinted pill that is also
 * the control: pick a status from it. One look everywhere it appears, in
 * the order's header and on each row of the Custom Orders list, so a
 * designer can move an order to In Progress without opening it.
 */
export default function DesignStatusPicker({ status, orderType, onChange, size = 'sm', disabled }: {
  status: string | null | undefined
  orderType: string | null | undefined
  onChange: (next: DesignStatus) => void
  size?: 'xs' | 'sm'
  disabled?: boolean
}) {
  const cur: DesignStatus = DESIGN_STATUS_CONFIG[status as DesignStatus] ? (status as DesignStatus) : 'not_started'
  const cfg = DESIGN_STATUS_CONFIG[cur]
  const pad = size === 'xs' ? 'pl-1.5 pr-1 py-0.5 text-[10px] gap-1 rounded' : 'pl-2 pr-1.5 py-1 text-xs gap-1.5 rounded'
  return (
    <label
      className={`relative inline-flex items-center font-medium whitespace-nowrap ${pad} ${cfg.bgColor} ${cfg.color} ${disabled ? '' : 'cursor-pointer'}`}
      // The row it sits on opens the order on click; a status pick is not that.
      onClick={e => e.stopPropagation()}
      title="Change the design status"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} aria-hidden />
      {designLabel(cur, orderType)}
      <ChevronDown className="w-3 h-3 opacity-60" />
      <select
        value={cur}
        disabled={disabled}
        onChange={e => onChange(e.target.value as DesignStatus)}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-default"
        aria-label="Design status"
      >
        {selectableDesignStatuses(orderType, status).map(st => (
          <option key={st} value={st}>{designLabel(st, orderType)}</option>
        ))}
      </select>
    </label>
  )
}
