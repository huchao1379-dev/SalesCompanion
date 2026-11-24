import { dataverseRequest, DataverseHttpError } from '../src/store/dataverseClient.js'
import { config } from '../src/config.js'

const tables = [
  `${config.dataversePrefix}_account`,
  `${config.dataversePrefix}_contact`,
  `${config.dataversePrefix}_activity`,
  `${config.dataversePrefix}_opportunity`,
  `${config.dataversePrefix}_aiinvocationlog`,
]

async function attrs(logical: string) {
  // Prefer: odata.include-annotations to get labels; keep select minimal
  const path =
    `EntityDefinitions(LogicalName='${logical}')/Attributes` +
    `?$select=LogicalName,AttributeType&$filter=AttributeOf eq null`
  const { data } = await dataverseRequest<{
    value: Array<{ LogicalName: string; AttributeType: string }>
  }>('GET', path)
  const custom = (data.value || [])
    .map((a) => a.LogicalName)
    .filter((n) => n.startsWith(`${config.dataversePrefix}_`))
    .sort()
  console.log('\n==', logical, '==')
  for (const n of custom) console.log(' ', n)
}

async function main() {
  for (const t of tables) {
    try {
      await attrs(t)
    } catch (err) {
      console.log(
        t,
        'FAIL',
        err instanceof DataverseHttpError
          ? `${err.status} ${err.body.slice(0, 200)}`
          : err,
      )
    }
  }
}

main()
