// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import { DocsLayoutProps } from "fumadocs-ui/layouts/notebook"
import { GithubInfo } from "../components/GithubInfo"

export function baseOptions(): Partial<DocsLayoutProps> {
  return {
    nav: {
      title: <span className="text-l font-bold">patrol_plus</span>,
      mode: "top",
    },
    tabMode: "navbar",
    sidebar: {
      tabs: [
        {
          title: "Overview",
          url: "/",
        },
        {
          title: "Documentation",
          url: "/documentation",
        },
        {
          title: "CLI commands",
          url: "/cli-commands",
        },
        {
          title: "Feature Guide",
          url: "/feature-guide",
        },
        {
          title: "Articles & Resources",
          url: "/articles",
        },
      ],
    },
    links: [
      {
        type: "custom",
        children: <GithubInfo owner="Bdaya-Dev" repo="patrol" className="lg:-mx-2" />,
      },
    ],
  }
}
