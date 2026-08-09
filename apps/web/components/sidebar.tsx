"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconActivity, IconBrandGithub, IconChevronDown, IconCode, IconGitPullRequest, IconLayoutDashboard, IconSettings } from "@tabler/icons-react";

const items = [
  ["Dashboard", "/", IconLayoutDashboard],
  ["Repositories", "/repositories", IconBrandGithub],
  ["PRs & Reviews", "/reviews", IconGitPullRequest],
  ["Settings", "/settings", IconSettings]
] as const;

export function Sidebar() {
  const path = usePathname();
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><IconCode size={18}/></div><span>reviewforge</span><span className="brand-badge">AI</span></div>
    <div className="workspace"><div className="workspace-icon">A</div><div><strong>Acme Engineering</strong><small>workspace</small></div><IconChevronDown size={14}/></div>
    <div className="nav-label">Workspace</div>
    <nav>{items.map(([label, href, Icon]) => <Link key={href} href={href} className={path === href || (href !== "/" && path.startsWith(href)) ? "nav-item active" : "nav-item"}><Icon size={17}/><span>{label}</span>{label === "PRs & Reviews" && <span className="nav-count">4</span>}</Link>)}</nav>
    <div className="sidebar-bottom"><div className="engine-status"><span className="pulse"/> Review engine online</div><div className="profile-mini"><div className="avatar">AS</div><div><strong>Akshay</strong><small>Developer</small></div><IconActivity size={15}/></div></div>
  </aside>;
}
