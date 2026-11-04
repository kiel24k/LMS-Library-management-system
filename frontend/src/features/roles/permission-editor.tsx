import { useId, useMemo, useState, type ReactNode } from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import {
  CheckIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  InfoIcon,
  ListIcon,
  ListTreeIcon,
  LockIcon,
  MinusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { applyPermissionChange, samePermissions, type CatalogIndex, type CatalogPermission } from "@/features/roles/permission-graph"
import type { Permission } from "@/lib/permissions"
import { readStorage, writeStorage } from "@/lib/storage"
import type { PermissionModule } from "@/types/api"

type ViewMode = "tree" | "list"
const VIEW_STORAGE_KEY = "lms.permissionView"
const NO_PERMISSION_HINT = "You don't have this permission"

/** Checkbox with a third, "some selected" state (module rows). Same look as components/ui/checkbox. */
function TriStateCheckbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-input/30 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-indeterminate:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current transition-none [&>svg]:size-3.5">
        {indeterminate ? <MinusIcon /> : <CheckIcon />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

/** Wraps a disabled checkbox so hovering it explains why. */
function LockedHint({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (!locked) return children
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>{NO_PERMISSION_HINT}</TooltipContent>
    </Tooltip>
  )
}

function readViewMode(): ViewMode {
  return readStorage(VIEW_STORAGE_KEY) === "list" ? "list" : "tree"
}

function matches(query: string, module: PermissionModule, p: CatalogPermission): boolean {
  if (!query) return true
  const haystack = [module.label, p.label, p.description ?? "", p.key].join(" ").toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

export type PermissionEditorProps = {
  index: CatalogIndex
  value: readonly Permission[]
  onChange: (next: Permission[]) => void
  /** False → checkboxes are shown but can't be changed. */
  editable: boolean
  /** Whether the signed-in user may turn this permission on (mirrors the API's PERMISSION_ESCALATION rule). */
  canAdd: (p: Permission) => boolean
}

/**
 * The permission picker of the role editor: a collapsible tree (module → permissions, tri-state module
 * checkbox) or a flat list, with search. Turning a permission on also turns on what it requires; turning one
 * off also turns off what depends on it — a note under the toolbar says what changed automatically.
 */
export function PermissionEditor({ index, value, onChange, editable, canAdd }: PermissionEditorProps) {
  const id = useId()
  const [view, setView] = useState<ViewMode>(readViewMode)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  // What the last click changed automatically; `result` lets it disappear once the selection changes another way (Discard).
  const [lastChange, setLastChange] = useState<{ added: Permission[]; removed: Permission[]; result: Permission[] } | null>(null)

  const selected = useMemo(() => new Set(value), [value])
  const trimmed = query.trim()

  /** Can be turned on: the user holds it (or the role already had it) and everything it pulls in. */
  const addable = (p: Permission) => canAdd(p) && index.requiresOf(p).every((r) => selected.has(r) || canAdd(r))

  const visibleModules = useMemo(
    () =>
      index.modules
        .map((m) => ({ module: m, permissions: m.permissions.filter((p) => matches(trimmed, m, p)) }))
        .filter((m) => m.permissions.length > 0),
    [index, trimmed],
  )
  const visibleCount = visibleModules.reduce((n, m) => n + m.permissions.length, 0)

  const change = (targets: Permission[], on: boolean) => {
    if (!editable || targets.length === 0) return
    const result = applyPermissionChange(index, value, targets, on)
    onChange(result.next)
    setLastChange(
      result.autoAdded.length || result.autoRemoved.length
        ? { added: result.autoAdded, removed: result.autoRemoved, result: result.next }
        : null,
    )
  }

  const changeView = (next: ViewMode) => {
    setView(next)
    writeStorage(VIEW_STORAGE_KEY, next)
  }

  const note = lastChange && samePermissions(lastChange.result, value) ? lastChange : null

  const labelOf = (p: Permission) => index.get(p)?.permission.label ?? p
  const requiresText = (p: CatalogPermission) => p.requires.map(labelOf).join(", ")

  const permissionCheckbox = (p: CatalogPermission, labelId: string, descriptionId?: string) => {
    const checked = selected.has(p.key)
    const locked = !checked && !addable(p.key)
    return (
      <LockedHint locked={editable && locked}>
        <TriStateCheckbox
          checked={checked}
          disabled={!editable || locked}
          onCheckedChange={(on) => change([p.key], on)}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          className="mt-0.5"
        />
      </LockedHint>
    )
  }

  const lockMark = (p: CatalogPermission) =>
    editable && !selected.has(p.key) && !addable(p.key) ? (
      <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={NO_PERMISSION_HINT} />
    ) : null

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="sm:max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Search permissions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search permissions"
          />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {view === "tree" && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!trimmed || collapsed.size === 0}
                onClick={() => setCollapsed(new Set())}
              >
                <ChevronsUpDownIcon data-icon="inline-start" />
                Expand all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!trimmed || collapsed.size === index.modules.length}
                onClick={() => setCollapsed(new Set(index.modules.map((m) => m.key)))}
              >
                <ChevronsDownUpIcon data-icon="inline-start" />
                Collapse all
              </Button>
            </>
          )}
          <Tabs value={view} onValueChange={(v) => changeView(v === "list" ? "list" : "tree")}>
            <TabsList aria-label="Show permissions as">
              <TabsTrigger value="tree" className="px-2.5">
                <ListTreeIcon />
                Tree
              </TabsTrigger>
              <TabsTrigger value="list" className="px-2.5">
                <ListIcon />
                List
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* What changed automatically */}
      <div aria-live="polite">
        {note && (
          <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-500/10 dark:text-sky-100">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              {note.added.length > 0 && (
                <p>
                  Also turned on (needed): <span className="font-medium">{note.added.map(labelOf).join(", ")}</span>
                </p>
              )}
              {note.removed.length > 0 && (
                <p>
                  Also turned off (they need it): <span className="font-medium">{note.removed.map(labelOf).join(", ")}</span>
                </p>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => setLastChange(null)} aria-label="Dismiss">
              <XIcon />
            </Button>
          </div>
        )}
      </div>

      {visibleCount === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No permissions match “{trimmed}”.
        </p>
      ) : view === "tree" ? (
        <div className="divide-y overflow-hidden rounded-lg border">
          {visibleModules.map(({ module: m, permissions }) => {
            const keys = m.permissions.map((p) => p.key)
            const count = keys.filter((k) => selected.has(k)).length
            const all = count === keys.length
            const some = count > 0 && !all
            const toAdd = keys.filter((k) => !selected.has(k) && addable(k))
            const open = !!trimmed || !collapsed.has(m.key)
            const moduleLabelId = `${id}-m-${m.key}`
            const groupId = `${id}-g-${m.key}`
            return (
              <div key={m.key} role="group" aria-labelledby={moduleLabelId}>
                <div className="flex items-center gap-1.5 bg-muted/40 py-1.5 pr-3 pl-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-expanded={open}
                    aria-controls={groupId}
                    disabled={!!trimmed}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(m.key)) next.delete(m.key)
                        else next.add(m.key)
                        return next
                      })
                    }
                  >
                    <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
                    <span className="sr-only">
                      {open ? "Collapse" : "Expand"} {m.label}
                    </span>
                  </Button>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1 has-data-disabled:cursor-default">
                    <LockedHint locked={editable && !all && toAdd.length === 0}>
                      <TriStateCheckbox
                        checked={all}
                        indeterminate={some}
                        disabled={!editable || (!all && toAdd.length === 0)}
                        onCheckedChange={() => (all ? change(keys, false) : change(toAdd, true))}
                        aria-labelledby={moduleLabelId}
                      />
                    </LockedHint>
                    <span id={moduleLabelId} className="truncate font-medium">
                      {m.label}
                    </span>
                  </label>
                  <Badge
                    variant={count > 0 ? "default" : "outline"}
                    className={cn("tabular-nums", some && "bg-primary/15 text-primary dark:bg-primary/25 dark:text-foreground")}
                    aria-label={`${count} of ${keys.length} on`}
                  >
                    {count} / {keys.length}
                  </Badge>
                </div>
                {open && (
                  <ul id={groupId} className="flex flex-col py-1">
                    {permissions.map((p) => {
                      const labelId = `${id}-p-${p.key}`
                      const descriptionId = `${id}-d-${p.key}`
                      return (
                        <li key={p.key}>
                          <label className="flex cursor-pointer items-start gap-3 py-2 pr-3 pl-11 hover:bg-muted/40 has-data-disabled:cursor-default has-data-disabled:hover:bg-transparent">
                            {permissionCheckbox(p, labelId, descriptionId)}
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="flex items-center gap-1.5">
                                <span id={labelId}>{p.label}</span>
                                {lockMark(p)}
                              </span>
                              <span id={descriptionId} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                                {p.description && <span>{p.description}</span>}
                                {p.requires.length > 0 && <span className="text-muted-foreground/80">Requires: {requiresText(p)}</span>}
                              </span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Permission</TableHead>
                <TableHead>Module</TableHead>
                <TableHead className="hidden md:table-cell">Requires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleModules.flatMap(({ module: m, permissions }) =>
                permissions.map((p) => {
                  const labelId = `${id}-lp-${p.key}`
                  const descriptionId = `${id}-ld-${p.key}`
                  return (
                    <TableRow key={p.key} data-state={selected.has(p.key) ? "selected" : undefined}>
                      <TableCell className="pl-3 whitespace-normal">
                        <label className="flex cursor-pointer items-start gap-3 has-data-disabled:cursor-default">
                          {permissionCheckbox(p, labelId, p.description ? descriptionId : undefined)}
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex items-center gap-1.5">
                              <span id={labelId}>{p.label}</span>
                              {lockMark(p)}
                            </span>
                            {p.description && (
                              <span id={descriptionId} className="text-xs text-muted-foreground">
                                {p.description}
                              </span>
                            )}
                          </span>
                        </label>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.label}</TableCell>
                      <TableCell className="hidden text-xs whitespace-normal text-muted-foreground md:table-cell">
                        {p.requires.length > 0 ? requiresText(p) : "—"}
                      </TableCell>
                    </TableRow>
                  )
                }),
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
