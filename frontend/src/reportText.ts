const GAP_LEADS: Record<string, string> = {
  method_gap: '在研究方法方面，',
  repeated_limitation: '在共同局限方面，',
  contradictory: '在研究结论的一致性方面，',
  unfulfilled_future: '在后续研究的落实方面，',
}

/** Present legacy labels as prose; leave code, links and unknown labels intact. */
export function formatReportText(markdown: string): string {
  let fence: { marker: string; length: number } | null = null
  return markdown.split('\n').map(line => {
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (boundary) {
      if (!fence) fence = { marker: boundary[1][0], length: boundary[1].length }
      else if (boundary[1][0] === fence.marker && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null
      return line
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line
    return line.replace(/^([ \t]*(?:(?:\d+[.)]|[-+*])[ \t]+)?)\[(method_gap|repeated_limitation|contradictory|unfulfilled_future)\](?![\[(])[ \t]*/,
      (_, prefix: string, type: string) => `${prefix}${GAP_LEADS[type]}`)
  }).join('\n')
}
