export type SummaryBlock =
  | { type: 'bullet'; label?: string; text: string; emphasis: boolean }
  | { type: 'paragraph'; text: string; emphasis: boolean }

const BULLET_RE = /^(?:[-*•]|[0-9]+[.)、])\s+(.+)$/
const LABEL_RE =
  /^(?:\*\*(.+?)\*\*|【(.+?)】|([^：:\n*]{1,12}))\s*[：:]\s*(.+)$/
const INLINE_FIELD_RE =
  /(客户|医院|联系人|对接人|产品|诉求|意向|结果|跟进|下次|风险|竞品|报价|预算)\s*[：:]\s*([^；;\n。]+)/g

function stripMd(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim()
}

function isEmphasisLine(label: string | undefined, text: string) {
  const hay = `${label || ''} ${text}`
  return /重要|风险|紧急|待办|跟进|结果|意向|报价|决策|阻塞|反对|竞品|客户|联系人|产品|诉求/.test(
    hay,
  )
}

function pushBullet(
  blocks: SummaryBlock[],
  label: string | undefined,
  text: string,
) {
  const cleanLabel = label ? stripMd(label) : undefined
  const cleanText = stripMd(text)
  if (!cleanText && !cleanLabel) return
  blocks.push({
    type: 'bullet',
    label: cleanLabel || undefined,
    text: cleanText || cleanLabel || '',
    emphasis: isEmphasisLine(cleanLabel, cleanText),
  })
}

/** Split a prose paragraph into labeled bullets when possible. */
function proseToBullets(text: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  const fieldHits = [...text.matchAll(INLINE_FIELD_RE)]
  if (fieldHits.length >= 2) {
    for (const hit of fieldHits) {
      pushBullet(blocks, hit[1], hit[2])
    }
    return blocks
  }

  const sentences = text
    .split(/(?<=[。！？；;])/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (sentences.length >= 2) {
    for (const sentence of sentences.slice(0, 6)) {
      const labeled = LABEL_RE.exec(sentence)
      if (labeled) {
        pushBullet(blocks, labeled[1] || labeled[2] || labeled[3], labeled[4] || '')
      } else {
        pushBullet(blocks, undefined, sentence)
      }
    }
    return blocks
  }

  pushBullet(blocks, undefined, text)
  return blocks
}

/** Parse AI summary text into bullets / paragraphs for rich display. */
export function parseSummaryContent(raw: string): SummaryBlock[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  const blocks: SummaryBlock[] = []
  for (const line of lines) {
    const bullet = BULLET_RE.exec(line)
    const body = bullet ? bullet[1].trim() : line
    const labeled = LABEL_RE.exec(body)
    if (bullet || labeled) {
      if (labeled) {
        pushBullet(blocks, labeled[1] || labeled[2] || labeled[3], labeled[4] || '')
      } else {
        pushBullet(blocks, undefined, body)
      }
      continue
    }
    blocks.push(...proseToBullets(body))
  }

  // Prefer a bullet list UI even when we only got one prose line that couldn't split
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return [{ ...blocks[0], type: 'bullet' }]
  }
  return blocks
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    if (bold) {
      return (
        <strong key={`b-${index}`} className="ai-summary-content__mark">
          {bold[1]}
        </strong>
      )
    }
    return <span key={`t-${index}`}>{part}</span>
  })
}

type Props = {
  text: string
  className?: string
}

export function AiSummaryContent({ text, className }: Props) {
  const blocks = parseSummaryContent(text)
  if (blocks.length === 0) {
    return <p className={`ai-summary-content__empty${className ? ` ${className}` : ''}`}>暂无总结</p>
  }

  return (
    <ul className={`ai-summary-content${className ? ` ${className}` : ''}`}>
      {blocks.map((block, index) => (
        <li
          key={`${block.type}-${index}`}
          className={`ai-summary-content__item${block.emphasis ? ' is-emphasis' : ''}${
            block.type === 'paragraph' ? ' is-para' : ''
          }`}
        >
          {block.type === 'bullet' && block.label ? (
            <span className="ai-summary-content__label">{block.label}</span>
          ) : null}
          <span className="ai-summary-content__body">{renderInline(block.text)}</span>
        </li>
      ))}
    </ul>
  )
}
