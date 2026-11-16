type Props = {
  name: string
  chain?: string[]
}

export function AgentLabel({ name, chain }: Props) {
  return (
    <div className="agent-label">
      <span className="agent-label__name">{name}</span>
      {chain && chain.length > 0 ? (
        <span className="agent-label__chain">{chain.join(' → ')}</span>
      ) : null}
    </div>
  )
}
