import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
export function Shell({children,title,action}:{children:React.ReactNode;title?:string;action?:React.ReactNode}) { return <div className="app-shell"><Sidebar/><main className="main"><Topbar title={title} action={action}/>{children}</main></div> }
