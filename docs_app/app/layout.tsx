// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import { config } from "@fortawesome/fontawesome-svg-core"
import { RootProvider } from "fumadocs-ui/provider/next"
import { Inter } from "next/font/google"
import "./global.css"
import "@fortawesome/fontawesome-svg-core/styles.css"

config.autoAddCss = false

const inter = Inter({
  subsets: ["latin"],
})

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
