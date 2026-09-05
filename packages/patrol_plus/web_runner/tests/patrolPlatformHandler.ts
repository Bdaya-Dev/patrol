import { BrowserContext } from "playwright"
import { actions } from "./actions"
import { PatrolNativeRequest } from "./contracts"
import { logger } from "./logger"
import { PageManager } from "./pageManager"

/**
 * Either a fixed PageManager, or a resolver returning the PageManager to
 * dispatch to at call time.
 *
 * The resolver form exists for the fork's PATROL_WEB_ISOLATION=page mode
 * (tests/test.spec.ts): there one worker-shared BrowserContext hosts a fresh
 * page — and therefore a fresh PageManager — per test, while Playwright only
 * allows a given binding name to be exposed ONCE per context.
 */
export type PageManagerSource = PageManager | (() => PageManager)

export async function exposePatrolPlatformHandler(context: BrowserContext, pageManager: PageManagerSource) {
  const resolvePageManager = pageManager instanceof PageManager ? () => pageManager : pageManager

  await context.exposeBinding("__patrol__platformHandler", async ({ page }, request) => {
    const manager = resolvePageManager()

    if (!manager.isInitialPage(page)) {
      throw new Error(`Unauthorized: only the initial test page can call the platform handler`)
    }

    return handlePatrolPlatformAction(manager, request)
  })
}

export async function handlePatrolPlatformAction(pageManager: PageManager, { action, params }: PatrolNativeRequest) {
  logger.info(params, `Received action: ${action}`)

  const actionFn = actions[action as keyof typeof actions]

  if (!actionFn) {
    throw new Error(`Action ${action} not found`)
  }

  try {
    return await actionFn({ pageManager, params: params as any })
  } catch (e) {
    logger.error(e, "Failed to handle patrol platform request")
    throw e
  }
}
