import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router"
import { ChevronDownIcon, LibraryIcon, LogOutIcon, PaletteIcon, PlusIcon, SettingsIcon } from "lucide-react"
import { cn } from "cn"

import { BrandMark } from "@/components/brand"
import { Can } from "@/components/can"
import { LibraryScopeProvider } from "@/components/library-scope-provider"
import { NAV_ITEMS } from "@/components/nav-items"
import { PageSkeleton } from "@/components/states"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { useLogout } from "@/features/auth/api"
import { allows, useAuth } from "@/features/auth/use-auth"
import { useCompany } from "@/features/company/api"
import { useDocumentTitle } from "@/features/company/use-document-title"
import { useDashboard } from "@/features/dashboard/api"
import { useLibraryScope } from "@/lib/library-scope"
import { THEME_MODES, setThemeMode, useTheme, type ThemeMode } from "@/lib/theme"

const ALL = "all"

function LibrarySwitcher() {
  const { libraries, libraryId, setLibraryId, isLoading } = useLibraryScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const items = [{ value: ALL, label: "All libraries" }, ...libraries.map((l) => ({ value: l.id, label: l.name }))]

  return (
    <div className="flex flex-col gap-1.5 px-1">
      <span className="text-xs font-medium text-sidebar-foreground/70">Library</span>
      <Select
        items={items}
        value={libraryId ?? ALL}
        disabled={isLoading}
        onValueChange={(value) => {
          setLibraryId(!value || value === ALL ? null : value)
          // A new scope starts again from page 1, and category filters belong to one library.
          if (searchParams.has("page") || searchParams.has("category")) {
            const next = new URLSearchParams(searchParams)
            next.delete("page")
            next.delete("category")
            setSearchParams(next, { replace: true })
          }
        }}
      >
        <SelectTrigger className="w-full bg-background" aria-label="Library">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function NavMenu() {
  const auth = useAuth()
  const { libraryId } = useLibraryScope()
  // The pending-requests badge comes from the dashboard numbers: only fetched with dashboard.view (and not while
  // the account must still change its password: the API refuses it until then).
  const dashboard = useDashboard(libraryId, { enabled: auth.can("dashboard.view") && !auth.user?.mustChangePassword })
  const pending = dashboard.data?.loans.pending ?? 0
  const location = useLocation()
  const { setOpenMobile, isMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.filter((item) => allows(auth, item.gate)).map((item) => {
            const active = item.end
              ? location.pathname === item.to
              : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={item.label}
                  render={<NavLink to={item.to} end={item.end} />}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false)
                  }}
                >
                  <Icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
                {item.badge === "pending" && pending > 0 && (
                  <SidebarMenuBadge
                    className="bg-amber-500 text-amber-950 peer-hover/menu-button:text-amber-950 peer-data-active/menu-button:text-amber-950"
                    aria-label={`${pending} pending requests`}
                  >
                    {pending > 99 ? "99+" : pending}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?"
}

// Bigger rows than the default menu: easier to read and hit for older staff.
const MENU_ROW = "min-h-11 gap-2.5 px-2.5 text-base [&_svg:not([class*='size-'])]:size-5"

/** Profile button at the right of the top bar: name, Profile settings, Light/Dark/Automatic, Log out. */
function ProfileMenu() {
  const { user } = useAuth()
  const logout = useLogout()
  const navigate = useNavigate()
  const { mode } = useTheme()
  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-10 gap-2 px-1.5 data-popup-open:bg-accent sm:pr-2.5"
            aria-label={`Profile menu for ${user.name}`}
          />
        }
      >
        <Avatar className="size-8 rounded-lg after:rounded-lg">
          <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">{initials(user.name)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{user.name}</span>
        <ChevronDownIcon className="hidden size-4 text-muted-foreground sm:inline" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-auto max-w-(--available-width) min-w-64">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar className="size-10 rounded-lg after:rounded-lg">
            <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={MENU_ROW} onClick={() => void navigate("/account")}>
          <SettingsIcon />
          Profile settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 text-sm">Light or dark</DropdownMenuLabel>
          {/* Picking one keeps the menu open, so the change can be seen right away. */}
          <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setThemeMode(value as ThemeMode)}>
            {THEME_MODES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value} className={cn(MENU_ROW, "pr-9")}>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuItem className={MENU_ROW} onClick={() => void navigate("/account#colors")}>
          <PaletteIcon />
          Change colors…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={MENU_ROW}
          disabled={logout.isPending}
          onClick={() => {
            logout.mutate(undefined, { onSettled: () => void navigate("/login", { replace: true }) })
          }}
        >
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AppSidebar() {
  const company = useCompany()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={company.name} render={<Link to="/" />}>
              <BrandMark size="sm" tone="sidebar" decorative />
              <span className="flex-1 truncate text-left text-sm font-semibold">{company.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="group-data-[collapsible=icon]:hidden">
          <LibrarySwitcher />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMenu />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

function TopBar() {
  const { library } = useLibraryScope()
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 h-4 self-center" />
      <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        <LibraryIcon className="mr-1 inline size-4 align-[-3px]" />
        {library ? library.name : "All libraries"}
      </div>
      <Can perm="loans.create">
        <Button size="sm" nativeButton={false} render={<Link to="/borrow-records/new" />}>
          <PlusIcon data-icon="inline-start" />
          Borrow Books
        </Button>
        <Separator orientation="vertical" className="mx-1 hidden h-6 self-center sm:block" />
      </Can>
      <ProfileMenu />
    </header>
  )
}

function ScopedContent() {
  const { isLoading } = useLibraryScope()
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6">
      {isLoading ? <PageSkeleton /> : <Outlet />}
    </div>
  )
}

/** Sidebar layout used by every signed-in page (one app for every account; the sidebar shows what the role allows). */
export function AppLayout() {
  useDocumentTitle()
  return (
    <LibraryScopeProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <TopBar />
          <ScopedContent />
        </SidebarInset>
      </SidebarProvider>
    </LibraryScopeProvider>
  )
}
