"use client";
import { IconBell, IconCommand, IconSearch, IconPlus } from "@tabler/icons-react";
export function Topbar({ title="Overview", action }: {title?:string; action?: React.ReactNode}) { return <header className="topbar"><div className="topbar-title">{title}</div><div className="topbar-tools"><div className="search"><IconSearch size={16}/><span>Search reviews, PRs, repositories...</span><kbd><IconCommand size={11}/> K</kbd></div>{action}<button className="icon-button"><IconBell size={17}/><i/></button><div className="avatar top-avatar">AS</div></div></header> }
