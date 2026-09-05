// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import { getPageImage, source } from "@/lib/source"
import { notFound } from "next/navigation"
import { ImageResponse } from "next/og"

export const revalidate = false

export async function GET(_req: Request, { params }: RouteContext<"/og/[...slug]">) {
  const { slug } = await params
  const page = source.getPage(slug.slice(0, -1))
  if (!page) notFound()

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0b0f",
        color: "#ffffff",
        fontFamily: "sans-serif",
        padding: "80px",
        textAlign: "center",
      }}>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>{page.data.title}</div>
      <div style={{ display: "flex", fontSize: 32, marginTop: 24, color: "#a1a1aa" }}>
        patrol_plus documentation
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  )
}

export function generateStaticParams() {
  return source.getPages().map(page => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }))
}
