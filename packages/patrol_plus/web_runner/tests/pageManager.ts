// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import type { Page, BrowserContext } from "playwright"

export class PageManager {
  private registry = new Map<string, Page>()
  private reverse = new Map<Page, string>()
  private _activeId: string
  readonly context: BrowserContext
  readonly initialPageId: string
  private nextIndex = 0

  // A stable reference (not an inline arrow in the constructor) so dispose()
  // can remove exactly this listener from the context again.
  private readonly onPage = (page: Page) => {
    this.register(page)
  }

  // `context` is assigned explicitly rather than declared as a constructor
  // parameter property: the fork's browser-level node test
  // (actions/inFlowSafety.browser.test.ts) loads this file under
  // `node --experimental-strip-types`, which rejects parameter properties.
  constructor(context: BrowserContext, initialPage: Page) {
    this.context = context
    this.initialPageId = this.register(initialPage)
    this._activeId = this.initialPageId

    this.context.on("page", this.onPage)
  }

  /**
   * Stops tracking pages opened in the context from now on. Used by the fork's
   * PATROL_WEB_ISOLATION=page mode (tests/test.spec.ts), where a worker-shared
   * context gets a new PageManager per test and the previous test's manager
   * must not keep registering pages.
   */
  dispose(): void {
    this.context.off("page", this.onPage)
  }

  private register(page: Page): string {
    const id = `page_${this.nextIndex++}`

    this.registry.set(id, page)
    this.reverse.set(page, id)

    const cleanup = () => {
      this.registry.delete(id)
      this.reverse.delete(page)
      if (this._activeId === id) {
        this._activeId = this.initialPageId
      }
    }

    page.on("close", cleanup)
    page.on("crash", cleanup)

    return id
  }

  resolve(pageId: string): Page {
    const page = this.registry.get(pageId)

    if (!page) {
      throw new Error(`No page found for page ID "${pageId}"`)
    }

    return page
  }

  async close(pageId: string): Promise<void> {
    if (pageId === this.initialPageId) {
      throw new Error("Cannot close the initial page")
    }

    const page = this.resolve(pageId)
    await page.close()
  }

  get activeId(): string {
    return this._activeId
  }

  set activeId(pageId: string) {
    if (!this.registry.has(pageId)) {
      throw new Error(`No page found for page ID "${pageId}"`)
    }

    this._activeId = pageId
  }

  get activePage(): Page {
    return this.resolve(this.activeId)
  }

  get count(): number {
    return this.registry.size
  }

  get ids(): string[] {
    return Array.from(this.registry.keys())
  }

  idOf(page: Page): string | undefined {
    return this.reverse.get(page)
  }

  isInitialPage(page: Page): boolean {
    return this.idOf(page) === this.initialPageId
  }
}
