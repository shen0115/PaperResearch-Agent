import type { Element, ElementContent, Root } from 'hast'
import type { Innovation } from './types'

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

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')
}

function preserveInnovationDetails(tree: Root, innovations: Innovation[]) {
  const body = normalized(headingText(element('div', {}, tree.children.filter(child => child.type !== 'doctype'))))
  const missing = innovations.flatMap((item, index) => {
    const title = item.title?.trim()
    const idea = item.idea?.trim()
    const hasTitle = title && body.includes(normalized(title))
    const hasIdea = idea && body.includes(normalized(idea))
    if ((!title || hasTitle) && (!idea || hasIdea)) return []
    if (hasTitle && idea && !hasIdea) {
      const heading = tree.children.findIndex(child =>
        child.type === 'element' && child.tagName === 'h3' && normalized(headingText(child)).includes(normalized(title)),
      )
      if (heading >= 0) {
        const nextHeading = tree.children.findIndex((child, position) =>
          position > heading && child.type === 'element' && /^h[1-3]$/.test(child.tagName),
        )
        tree.children.splice(nextHeading < 0 ? tree.children.length : nextHeading, 0, element('p', {}, [text(idea)]))
        return []
      }
    }
    return [
      element('h3', {}, [text(title || `创新点 ${index + 1}`)]),
      ...(idea && !hasIdea ? [element('p', {}, [text(idea)])] : []),
    ]
  })
  if (!missing.length) return

  const sectionIndex = tree.children.findIndex(child =>
    child.type === 'element' && child.tagName === 'h2' && /创新(?:点|思路|方案|建议)/u.test(headingText(child)),
  )
  if (sectionIndex < 0) {
    tree.children.push(element('h2', {}, [text('创新思路补充')]), ...missing)
    return
  }
  const nextSection = tree.children.findIndex((child, index) =>
    index > sectionIndex && child.type === 'element' && /^h[12]$/.test(child.tagName),
  )
  tree.children.splice(nextSection < 0 ? tree.children.length : nextSection, 0, ...missing)
}

export default function reportNavigation(innovations: Innovation[] = []) {
  return (tree: Root) => {
    if (innovations.length) preserveInnovationDetails(tree, innovations)
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

    const sections = headings.filter(heading => heading.depth === 2)
    const links = element('ol', {}, sections.map(heading =>
      element('li', {}, [
        element('a', { href: `#${heading.id}` }, [text(
          heading.label.replace(/^\s*(?:[一二三四五六七八九十百]+[、.．]\s*|\d+[.、．]\s*)/u, '') || heading.label,
        )]),
      ]),
    ))

    const prose = tree.children.filter(child => child.type !== 'doctype')
    const first = prose.findIndex(child => child.type !== 'text' || child.value.trim())
    const firstNode = prose[first]
    const title = firstNode?.type === 'element' && firstNode.tagName === 'h1'
      ? prose.splice(first, 1)[0]
      : element('h1', {}, [text('研究报告')])
    const actions = sections.length >= 4 ? [
      element('nav', { className: ['report-toc'], ariaLabel: '章节导航' }, [
        element('details', {}, [element('summary', { className: ['btn', 'btn-secondary'] }, [text('目录')]), links]),
      ]),
    ] : []
    tree.children = [
      element('header', { className: ['report-toolbar'] }, [title, ...actions]),
      element('div', { className: ['report-prose'] }, prose),
    ]
  }
}
