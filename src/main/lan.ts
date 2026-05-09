/**
 * LAN URL is primarily sourced from `health-check.ps1` (`phoneAccess.url`)
 * because it already selects a reasonable IPv4 address on Windows.
 */
export function formatLanUrl(lanIp: string, port: number): string {
  return `http://${lanIp}:${port}`
}
