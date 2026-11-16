import { useEffect, useState } from 'react'
import type { DraftPayload, OpportunityDraftPayload } from '../agents/types'
import { DraftCard } from '../components/DraftCard'
import { confirmAndSync, discardDraft, listDrafts, upsertDraft } from '../data/dataverse'
import { subscribeDrafts } from '../data/draftStore'

type Props = {
  seedDrafts?: DraftPayload[]
}

function mergeOpportunityDrafts(
  seedDrafts: DraftPayload[],
  stored: DraftPayload[],
): OpportunityDraftPayload[] {
  const map = new Map<string, OpportunityDraftPayload>()
  ;[...stored, ...seedDrafts].forEach((d) => {
    if (d.kind === 'opportunity') map.set(d.idempotencyKey, d)
  })
  return [...map.values()]
}

export function OpportunityDraftScreen({ seedDrafts = [] }: Props) {
  const [stored, setStored] = useState<DraftPayload[]>(() => listDrafts())
  const [busy, setBusy] = useState(false)
  const [simulateFail, setSimulateFail] = useState(false)
  const drafts = mergeOpportunityDrafts(seedDrafts, stored)

  useEffect(() => {
    return subscribeDrafts((all) => {
      setStored(all)
    })
  }, [])

  function updateDraft(next: DraftPayload) {
    if (next.kind !== 'opportunity') return
    upsertDraft({ ...next, updatedAt: new Date().toISOString() })
  }

  async function handleConfirm(draft: DraftPayload) {
    setBusy(true)
    try {
      await confirmAndSync(draft, { fail: simulateFail })
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard(draft: DraftPayload) {
    setBusy(true)
    try {
      await discardDraft(draft)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="screen opportunity">
      <header>
        <p className="home__eyebrow">商机创建</p>
        <h1>AI 草稿 · 确认后同步</h1>
        <p className="muted">信心度 + 来源 + 一键编辑；写入走草稿三段式。</p>
      </header>

      <label className="capture__fail-toggle">
        <input
          type="checkbox"
          checked={simulateFail}
          onChange={(e) => setSimulateFail(e.target.checked)}
        />
        模拟 SAP 同步失败（用于验证重试）
      </label>

      {drafts.length === 0 ? (
        <p className="muted">暂无商机草稿。请先在「活动录入」或「对话」用语音 / 仁济示例生成。</p>
      ) : (
        <div className="draft-list">
          {drafts.map((d) => (
            <DraftCard
              key={d.idempotencyKey}
              draft={d}
              busy={busy}
              onChange={updateDraft}
              onConfirm={(draft) => {
                void handleConfirm(draft)
              }}
              onDiscard={(draft) => {
                void handleDiscard(draft)
              }}
              onRetry={(draft) => {
                void handleConfirm({ ...draft, syncStatus: 'Draft' })
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
