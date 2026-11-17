import './SheetScrim.css'

type Props = {
  label: string
  onClose: () => void
}

/** Full-screen dimmed backdrop for bottom sheets / overlays. */
export function SheetScrim({ label, onClose }: Props) {
  return <button type="button" className="sheet-scrim" aria-label={label} onClick={onClose} />
}
