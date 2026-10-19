/**
 * 浏览器内分页器：由 scripts/book-pdf.ts 通过 page.evaluate(paginate, args) 调用。
 *
 * 该函数会被序列化后在页面里独立运行，因此**不能引用模块外的任何变量**（类型除外）。
 * 分页采用"固定页框 + 手工装填"：每页 .page 恒为 A4，正文装进 .page-body，
 * 按 CSS 外边距折叠规则（相邻取较大值、页首第一块外边距置 0）累加占位高度。
 */

export type PaginateArgs = {
  cover: { title: string; subtitle: string; meta: string[]; note: string[] }
  imageCount: number
}

export type PaginateResult = {
  pages: number
  tocPages: number
  overflow: string[]
  images: number
  expectedImages: number
  sections: { heading: string; page: number }[]
}

export function paginate(args: PaginateArgs): PaginateResult {
  const stage = document.getElementById('stage') as HTMLElement
  const flow = document.getElementById('flow') as HTMLElement
  const measure = document.getElementById('measure') as HTMLElement
  const overflow: string[] = []

  const escape = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  /** 封面的说明文字来自 Markdown 引用行，只处理 **加粗**，其余按纯文本 */
  const inlineNote = (text: string): string =>
    escape(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')

  const makePage = (kind: 'toc' | 'body'): { page: HTMLElement; body: HTMLElement } => {
    const page = document.createElement('div')
    page.className = 'page'
    page.dataset.kind = kind
    page.innerHTML =
      '<div class="page-head"><span class="hl"></span><span class="hr"></span></div>' +
      '<div class="page-body"></div>' +
      '<div class="page-foot"><span class="fl"></span><span class="page-num"></span></div>'
    stage.appendChild(page)
    return { page, body: page.querySelector('.page-body') as HTMLElement }
  }

  const probe = makePage('body')
  const LIMIT = probe.body.getBoundingClientRect().height
  probe.page.remove()

  const px = (value: string): number => Number.parseFloat(value) || 0
  const marginTop = (element: HTMLElement): number => px(getComputedStyle(element).marginTop)
  const marginBottom = (element: HTMLElement): number => px(getComputedStyle(element).marginBottom)

  let current: { page: HTMLElement; body: HTMLElement } | null = null
  let remaining = LIMIT
  let prevBottom = 0
  let pageNo = 0
  let sectionTitle = ''
  const headingPage = new Map<HTMLElement, number>()
  const pages: HTMLElement[] = []

  const currentPage = (): { page: HTMLElement; body: HTMLElement } => {
    if (current === null) throw new Error('分页状态异常')
    return current
  }

  const openPage = (): { page: HTMLElement; body: HTMLElement } => {
    current = makePage('body')
    current.page.dataset.section = sectionTitle
    pageNo += 1
    pages.push(current.page)
    remaining = LIMIT
    prevBottom = 0
    return current
  }

  const chapters = Array.from(flow.querySelectorAll('section.chapter')) as HTMLElement[]
  const chapterPage = new Map<HTMLElement, number>()

  for (const chapter of chapters) {
    sectionTitle = chapter.dataset.title ?? ''
    openPage()
    chapterPage.set(chapter, pageNo)
    const blocks = Array.from(chapter.children) as HTMLElement[]
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index] as HTMLElement
      if (block.tagName === 'H2') {
        // 章标题就是本页第一块：先落到页面上，再记录它的页码
        const holder = currentPage()
        holder.body.appendChild(block)
        headingPage.set(block, pageNo)
        remaining = LIMIT - (block.offsetTop + block.offsetHeight)
        prevBottom = marginBottom(block)
        continue
      }
      const height = block.getBoundingClientRect().height
      const top = Math.max(prevBottom, marginTop(block))
      // 标题与后两块同页，避免页末孤行
      // 标题与后两块同页，避免页末孤行；但后一块如果是很长的表格，不应把整张表的高度都算进预留下限
      let lookahead = 0
      if (block.tagName === 'H3' || block.tagName === 'H4') {
        let bottom = marginBottom(block)
        for (let next = index + 1; next < Math.min(index + 3, blocks.length); next += 1) {
          const follow = blocks[next] as HTMLElement
          lookahead += Math.max(bottom, marginTop(follow)) + Math.min(follow.getBoundingClientRect().height, 170)
          bottom = marginBottom(follow)
        }
      }
      let need = top + height
      const isHeadingBlock = block.tagName === 'H3' || block.tagName === 'H4'
      const isTable = block.tagName === 'TABLE'
      if (isHeadingBlock) {
        // 标题与后两块同页，避免页末孤行标题
        if (need + lookahead > remaining + 1) {
          openPage()
          need = height
        }
      } else if (isTable) {
        // 表格整张放得下一页时：剩余空间还多就让表格接着排（按行拆），
        // 只剩零头才整体后移，避免出现半页空白；后移时把紧挨着的标题一起带走，避免页末孤行标题
        if (need > remaining + 1 && height <= LIMIT && remaining < LIMIT * 0.35) {
          const pageBody = currentPage().body
          const previous = pageBody.lastElementChild as HTMLElement | null
          const orphan = previous !== null && (previous.tagName === 'H3' || previous.tagName === 'H4') ? previous : null
          openPage()
          if (orphan !== null) {
            pageBody.removeChild(orphan)
            const reopened = currentPage().body
            reopened.insertBefore(orphan, reopened.firstChild)
            headingPage.set(orphan, pageNo)
          }
          need = height
        }
      } else if (block.classList.contains('notes')) {
        // 注释块允许跨页续排，不做整块后移
      } else if (need > remaining + 1) {
        openPage()
        need = height
      }
      const holder = currentPage()
      if (need > remaining + 1) {
        if (isTable) {
          splitTable(block as HTMLTableElement, holder.body)
          continue
        }
        if (block.classList.contains('notes')) {
          splitNotes(block, holder.body)
          continue
        }
        overflow.push(`${sectionTitle}：<${block.tagName.toLowerCase()}> 高 ${Math.round(need)}px 超过版心 ${Math.round(LIMIT)}px`)
      }
      holder.body.appendChild(block)
      // 以真实版面位置校正：估算与实际差几像素时，宁可把这一块挪到下一页
      let bottom = block.offsetTop + block.offsetHeight
      if (bottom > LIMIT + 1 && holder.body.children.length > 1) {
        holder.body.removeChild(block)
        const reopened = openPage()
        reopened.body.appendChild(block)
        bottom = block.offsetTop + block.offsetHeight
        if (bottom > LIMIT + 1) {
          overflow.push(`${sectionTitle}：<${block.tagName.toLowerCase()}> 放入整页后仍超出 ${Math.round(bottom - LIMIT)}px`)
        }
      }
      remaining = LIMIT - bottom
      prevBottom = marginBottom(block)
      if (block.tagName === 'H3' || block.tagName === 'H4') headingPage.set(block, pageNo)
    }
  }

  /** 注释块按条目拆页：条目之间可断开，页首续排时保留上边框；以真实版面位置判断是否放得下 */
  function splitNotes(block: HTMLElement, firstBody: HTMLElement): void {
    const items = Array.from(block.children) as HTMLElement[]
    let body = firstBody
    let clone = block.cloneNode(false) as HTMLElement
    body.appendChild(clone)
    for (const item of items) {
      clone.appendChild(item.cloneNode(true))
      const bottom = clone.offsetTop + clone.offsetHeight
      if (bottom <= LIMIT + 1) continue
      clone.removeChild(clone.lastElementChild as Node)
      const opened = openPage()
      body = opened.body
      clone = block.cloneNode(false) as HTMLElement
      body.appendChild(clone)
      clone.appendChild(item.cloneNode(true))
      const after = clone.offsetTop + clone.offsetHeight
      if (after > LIMIT + 1) overflow.push(`注释单条高 ${Math.round(after)}px 超过版心`)
    }
    remaining = LIMIT - (clone.offsetTop + clone.offsetHeight)
    prevBottom = marginBottom(clone)
    block.remove()
  }

  function splitTable(table: HTMLTableElement, firstBody: HTMLElement): void {
    const rows = Array.from(table.querySelectorAll('tbody tr')) as HTMLElement[]
    const template = table.cloneNode(true) as HTMLTableElement
    template.querySelector('tbody')?.replaceChildren()
    let body = firstBody
    let clone = template.cloneNode(true) as HTMLTableElement
    body.appendChild(clone)
    for (const row of rows) {
      const tbody = clone.querySelector('tbody') as HTMLElement
      tbody.appendChild(row.cloneNode(true))
      if (clone.offsetTop + clone.offsetHeight <= LIMIT + 1) continue
      tbody.removeChild(tbody.lastElementChild as Node)
      const opened = openPage()
      body = opened.body
      clone = template.cloneNode(true) as HTMLTableElement
      body.appendChild(clone)
      ;(clone.querySelector('tbody') as HTMLElement).appendChild(row.cloneNode(true))
      const after = clone.offsetTop + clone.offsetHeight
      if (after > LIMIT + 1) overflow.push(`表格单行加表头高 ${Math.round(after)}px 超过版心 ${Math.round(LIMIT)}px`)
    }
    remaining = LIMIT - (clone.offsetTop + clone.offsetHeight)
    prevBottom = marginBottom(clone)
    table.remove()
  }

  // ---- 目录条目：直接按分页时记录的“标题元素→页码”，顺序即文档顺序
  type Entry = { level: number; text: string; page: number }
  const entries: Entry[] = []
  for (const [element, page] of headingPage) {
    const level = element.tagName === 'H2' ? 2 : 3
    const text = (element.dataset.toc ?? element.textContent ?? '').replace(/\s+/g, ' ').trim()
    entries.push({ level, text, page })
  }

  const makeRow = (entry: Entry, offset: number): HTMLElement => {
    const row = document.createElement('div')
    row.className = `toc-row lvl${entry.level}`
    row.innerHTML = `<span class="t">${escape(entry.text)}</span><span class="dots"></span><span class="num">${
      entry.page + offset
    }</span>`
    return row
  }

  const tocTitle = (): HTMLElement => {
    const node = document.createElement('div')
    node.className = 'toc-title'
    node.textContent = '目 录'
    return node
  }

  /** 在隐藏量具里排一遍目录：按实际版面位置（含外边距）切页，返回按页分组的节点 */
  const buildTocGroups = (offset: number): HTMLElement[][] => {
    measure.replaceChildren()
    const nodes = [tocTitle(), ...entries.map((entry) => makeRow(entry, offset))]
    const groups: HTMLElement[][] = [[]]
    let bucket = document.createElement('div')
    bucket.className = 'toc-group'
    measure.appendChild(bucket)
    for (const node of nodes) {
      bucket.appendChild(node)
      const bottom = node.offsetTop + node.offsetHeight
      if (bottom > LIMIT + 1 && bucket.children.length > 1) {
        bucket.removeChild(node)
        bucket = document.createElement('div')
        bucket.className = 'toc-group'
        measure.appendChild(bucket)
        bucket.appendChild(node)
        groups.push([])
      }
      groups[groups.length - 1]?.push(node)
    }
    return groups
  }

  let tocPages = 1
  let offset = 1 + tocPages
  for (let round = 0; round < 6; round += 1) {
    const groups = buildTocGroups(offset)
    if (groups.length === tocPages) break
    tocPages = groups.length
    offset = 1 + tocPages
  }

  const tocGroups = buildTocGroups(offset)
  measure.replaceChildren()
  const cover = document.createElement('div')
  cover.className = 'page'
  cover.dataset.kind = 'cover'
  const metaRows = args.cover.meta
    .map((line) => {
      const match = /^([^：:]+)[：:]\s*(.*)$/.exec(line)
      if (match === null) return `<div>${escape(line)}</div>`
      return `<div><b>${escape(match[1] ?? '')}</b>　${escape(match[2] ?? '')}</div>`
    })
    .join('')
  cover.innerHTML = `<div class="cover">
      <div class="kicker">项目书 · PROJECT PROPOSAL</div>
      <h1>${escape(args.cover.title)}</h1>
      <div class="sub">${escape(args.cover.subtitle)}</div>
      <div class="rule"></div>
      <div class="meta">${metaRows}</div>
      <div class="note">${args.cover.note.map((line) => `<div>${inlineNote(line)}</div>`).join('')}</div>
    </div>`
  stage.insertBefore(cover, stage.firstChild)

  let anchor = cover.nextSibling
  for (const group of tocGroups) {
    const holder = makePage('toc')
    holder.page.dataset.section = '目录'
    for (const node of group) holder.body.appendChild(node)
    stage.insertBefore(holder.page, anchor)
    anchor = holder.page.nextSibling
  }
  tocPages = tocGroups.length

  const all = Array.from(stage.querySelectorAll('.page')) as HTMLElement[]
  all.forEach((node, index) => {
    const kind = node.dataset.kind
    const num = node.querySelector('.page-num')
    if (kind === 'cover') {
      if (num !== null) num.textContent = ''
      return
    }
    if (num !== null) num.textContent = String(index + 1)
    const hl = node.querySelector('.hl')
    if (hl !== null) hl.textContent = '趣有度｜青年大额消费的资金安排与方案比较工具'
    const hr = node.querySelector('.hr')
    if (hr !== null) hr.textContent = node.dataset.section ?? ''
  })

  // 复核：每页最后一块的下缘不得超过版心
  for (const node of all) {
    if (node.dataset.kind === 'cover') continue
    const body = node.querySelector('.page-body') as HTMLElement
    let bottom = 0
    for (const child of Array.from(body.children) as HTMLElement[]) {
      bottom = Math.max(bottom, child.offsetTop + child.offsetHeight)
    }
    if (bottom > LIMIT + 1.5) {
      overflow.push(`第 ${all.indexOf(node) + 1} 页（${node.dataset.section ?? ''}）超出 ${Math.round(bottom - LIMIT)}px`)
    }
  }

  const sections = (Array.from(stage.querySelectorAll('h2.chap')) as HTMLElement[]).map((title) => {
    let node: HTMLElement | null = title
    while (node !== null && !node.classList.contains('page')) node = node.parentElement
    return {
      heading: (title.textContent ?? '').replace(/\s+/g, ' ').trim(),
      page: node === null ? 0 : all.indexOf(node) + 1,
    }
  })

  return {
    pages: all.length,
    tocPages,
    overflow,
    images: stage.querySelectorAll('img').length,
    expectedImages: args.imageCount,
    sections,
  }
}
