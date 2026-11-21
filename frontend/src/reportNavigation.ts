import type { Element, ElementContent, Root } from 'hast'

interface Heading {
  id: string
  label: string
  depth: number
}

function element(tagName: string, properties: Element['properties'], children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

function text(value: string): ElementContent {
  return { type: 'text', value }
}

function visitElements(node: Root | Element, visit: (element: Element) => void) {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    visit(child)
    visitElements(child, visit)
  }
}

function headingText(node: Element): string {
  return node.children.map(child => {
    if (child.type === 'text') return child.value
    if (child.type !== 'element') return ''
    if (child.tagName === 'img') return String(child.properties.alt ?? '')
    return headingText(child)
  }).join('')
}

function slug(label: string): string {
  return label.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section'
}

export default function reportNavigation() {
  return (tree: Root) => {
    const headings: Heading[] = []
    const fragments = new Map<string, string>()
    visitElements(tree, node => {
      if (!/^h[1-3]$/.test(node.tagName)) return
      const label = headingText(node).trim()
      const base = slug(label)
      let fragment = base
      for (let suffix = 1; fragments.has(fragment); suffix += 1) fragment = `${base}-${suffix}`
      const id = `report-section-${fragment}`
      fragments.set(fragment, id)
      node.properties.id = id
      headings.push({ id, label: label || '未命名章节', depth: Number(node.tagName[1]) })
    })

    if (!headings.length) return
    visitElements(tree, node => {
      const href = node.properties.href
      if (node.tagName !== 'a' || typeof href !== 'string' || !href.startsWith('#')) return
      try {
        const id = fragments.get(slug(decodeURIComponent(href.slice(1))))
        if (id) node.properties.href = `#${id}`
      } catch {
        // Leave fragments with invalid percent encoding as written.
      }
    })

    // Only major sections belong in the compact navigation; keep all heading anchors.
    const sections = headings.filter(heading => heading.depth === 2)
    if (!sections.length) return
    const links = element('ol', {}, sections.map(heading =>
      element('li', {}, [
        element('a', { href: `#${heading.id}` }, [text(
          heading.label.replace(/^\s*(?:[一二三四五六七八九十百]+[、.．]\s*|\d+[.、．]\s*)/u, '') || heading.label,
        )]),
      ]),
    ))

    tree.children = [
      element('nav', { className: ['report-toc'], ariaLabel: '章节导航' }, [
        element('details', {}, [element('summary', {}, [text('章节导航')]), links]),
      ]),
      element('div', { className: ['report-prose'] }, tree.children.filter(child => child.type !== 'doctype')),
    ]
  }
}
