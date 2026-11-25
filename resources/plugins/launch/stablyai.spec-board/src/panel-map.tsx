// The 全貌 tab: the map of both frameworks, and the command palette that runs their commands.
//
// The map is written down, not scanned, so it is there before anything is loaded: the stages, the
// artifacts, the correspondence and the decision tree. Only the pickers and the buttons need a
// board.
//
// The buttons come from the action catalog, never from the map's own rows. The rows hold a second
// copy of the `<change-id>` convention, in strings meant for a person to read; a button built
// from them would substitute the change id in the renderer and step around the gate in
// `command-values.ts`. So the panel names an action, and the worker resolves it into a command.

import { Badge, Card, Grid, Heading, KeyValue, Row, Select, Stack, Text, read, set } from 'orca'
import { frameworkActions } from './actions'
import {
  CORRESPONDENCE,
  OPENSPEC_DECISION_TREE,
  OPENSPEC_STAGES,
  SUPERPOWERS_FLOW,
  type FrameworkStage,
  type SuperpowersStep
} from './framework-map'
import type { Action, SnapshotProject, WorkItem } from './model'
import { PaletteButton, type Palette } from './panel-map-actions'
import { mapChange, mapProject, payload } from './panel-state'

/** The project the palette runs in: the one picked, or the first the board knows. */
function selectedProject(projects: readonly SnapshotProject[]): SnapshotProject | null {
  const chosen = read(mapProject)
  return projects.find((entry) => entry.id === chosen) ?? projects[0] ?? null
}

/** The change ids of one project: the changes the board knows for it. */
function changeIdsOf(project: SnapshotProject, items: readonly WorkItem[]): string[] {
  const ids: string[] = []
  for (const item of items) {
    const changeId = item.openspec?.changeId
    if (item.projectId === project.id && changeId !== undefined && !ids.includes(changeId)) {
      ids.push(changeId)
    }
  }
  return ids
}

/** One command of a stage: what it is, and the button that runs it. */
function CommandRow({
  label,
  command,
  action,
  palette,
  row
}: {
  label: string
  command: string
  /** The catalog action of the row; null for a command the plugin only documents. */
  action: Action | null
  palette: Palette
  row: string
}) {
  return (
    <Row gap="sm" align="start" wrap>
      <Stack gap="none">
        <Text size="xs" weight="medium">
          {label}
        </Text>
        <Text size="xs" muted>
          {command}
        </Text>
      </Stack>
      {action === null ? null : (
        <PaletteButton action={action} palette={palette} row={row} />
      )}
    </Row>
  )
}

/** One stage of OpenSpec: the files it works on, and the commands that drive it. */
function OpenspecStage({ stage, palette }: { stage: FrameworkStage; palette: Palette }) {
  return (
    <Stack gap="xs">
      <Text size="sm" weight="semibold">
        {stage.title}
      </Text>
      <Row gap="xs" wrap>
        {stage.artifacts.map((artifact) => (
          <Badge key={artifact} tone="neutral">
            {artifact}
          </Badge>
        ))}
      </Row>
      {stage.commands.map((command) => (
        <CommandRow
          key={`${stage.id}:${command.label}`}
          label={command.label}
          command={command.command}
          action={
            command.actionId === undefined ? null : (palette.actions.get(command.actionId) ?? null)
          }
          palette={palette}
          row={stage.id}
        />
      ))}
    </Stack>
  )
}

/** One step of Superpowers: what the skill does, what it leaves behind, and where the gate is. */
function SuperpowersStepRow({ step, palette }: { step: SuperpowersStep; palette: Palette }) {
  const action = step.actionId === undefined ? null : (palette.actions.get(step.actionId) ?? null)
  return (
    <Row gap="sm" align="start" wrap>
      <Stack gap="none">
        <Text size="xs" weight="medium">
          {step.skill}
        </Text>
        <Text size="xs" muted>
          {step.role}
        </Text>
        {step.artifact === null ? null : (
          <Text size="xs" muted>
            {`产出 ${step.artifact}`}
          </Text>
        )}
        {step.gate === null ? null : (
          <Text size="xs" tone="warning">
            {`门禁 ${step.gate}`}
          </Text>
        )}
      </Stack>
      {action === null ? null : <PaletteButton action={action} palette={palette} row={step.skill} />}
    </Row>
  )
}

/** The OpenSpec card: the three stages, the files each works on, and the commands. */
function OpenspecCard({ palette }: { palette: Palette }) {
  // The badge says what the button does, not what the project owns: without the CLI the command
  // runs no command at all, and the person must see that before pressing it.
  const withoutCli =
    palette.project !== null && palette.project.openspecCli?.available !== true
  return (
    <Card>
      <Stack gap="sm">
        <Row gap="xs" align="center" wrap>
          <Heading level={3}>OpenSpec</Heading>
          {withoutCli ? <Badge tone="warning">无 CLI</Badge> : null}
        </Row>
        {OPENSPEC_STAGES.map((stage) => (
          <OpenspecStage key={stage.id} stage={stage} palette={palette} />
        ))}
      </Stack>
    </Card>
  )
}

/** The Superpowers card: the fifteen skills in the order the process runs. */
function SuperpowersCard({ palette }: { palette: Palette }) {
  return (
    <Card>
      <Stack gap="sm">
        <Heading level={3}>Superpowers</Heading>
        {SUPERPOWERS_FLOW.map((step) => (
          <SuperpowersStepRow key={step.skill} step={step} palette={palette} />
        ))}
      </Stack>
    </Card>
  )
}

/** The correspondence: what each OpenSpec artifact answers with the Superpowers one. */
function Correspondence() {
  return (
    <KeyValue
      label="对应关系"
      items={CORRESPONDENCE.map((row) => ({
        label: `${row.openspec} ↔ ${row.superpowers}`,
        value: row.note
      }))}
    />
  )
}

/** The decision tree: whether this change needs a proposal at all. */
function DecisionTree() {
  return (
    <Stack gap="sm">
      <Heading level={3}>要不要写 proposal</Heading>
      {OPENSPEC_DECISION_TREE.map((rule) => (
        <Card key={rule.situation} title={rule.situation} description={rule.action} />
      ))}
    </Stack>
  )
}

/** The project the commands run in. */
function ProjectPicker({
  projects,
  project
}: {
  projects: readonly SnapshotProject[]
  project: SnapshotProject
}) {
  return (
    <Select
      label="项目"
      value={project.id}
      options={projects.map((entry) => ({
        value: entry.id,
        label: `${entry.name} · ${entry.host}`
      }))}
      onChange={(value) => {
        set(mapProject, value)
        // A change of another project is not this project's change.
        set(mapChange, null)
      }}
    />
  )
}

/** The change the change-scoped commands act on. */
function ChangePicker({ changes, change }: { changes: readonly string[]; change: string | null }) {
  return (
    <Select
      label="变更"
      value={change ?? undefined}
      placeholder="选一个变更"
      options={changes.map((id) => ({ value: id, label: id }))}
      onChange={(value) => {
        set(mapChange, value)
      }}
    />
  )
}

/** The 全貌 tab: the map of both frameworks, and the palette that runs their commands. */
export function MapTab() {
  const board = read(payload)
  const projects = board?.projects ?? []
  const items = board?.items ?? []
  const project = selectedProject(projects)
  const changes = project === null ? [] : changeIdsOf(project, items)
  const picked = read(mapChange)
  // A change the board no longer knows is not a change of this project.
  const change = picked !== null && changes.includes(picked) ? picked : null
  const catalog = frameworkActions(project?.openspecCli?.available === true)
  const palette: Palette = {
    project,
    change,
    actions: new Map(
      [...catalog.openspec, ...catalog.superpowers].map((action) => [action.id, action])
    )
  }
  return (
    <Stack gap="md">
      {project === null ? null : (
        <Stack gap="sm">
          <ProjectPicker projects={projects} project={project} />
          <ChangePicker changes={changes} change={change} />
        </Stack>
      )}
      <Grid columns={2} gap="md">
        <OpenspecCard palette={palette} />
        <SuperpowersCard palette={palette} />
      </Grid>
      <Correspondence />
      <DecisionTree />
    </Stack>
  )
}
