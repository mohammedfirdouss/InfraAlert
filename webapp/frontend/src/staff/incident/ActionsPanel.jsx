import { Link } from 'react-router-dom'
import { formatDateTime } from '../ui.jsx'
import AssignAction from './AssignAction.jsx'
import CloseAction from './CloseAction.jsx'
import MergeAction from './MergeAction.jsx'
import { Plate } from './Plate.jsx'
import ProgressActions from './ProgressActions.jsx'
import SplitAction from './SplitAction.jsx'
import TriageAction from './TriageAction.jsx'
import { allowedActions, shortRef, suggestedIssueType } from './format.js'

/**
 * @typedef {{ ok: boolean, message?: string }} Outcome
 * @typedef {{
 *   triage: (type: string) => Promise<Outcome>,
 *   assign: (team: import('../api.js').CandidateTeam) => Promise<Outcome>,
 *   onSite: () => Promise<Outcome>,
 *   resolve: (note: string) => Promise<Outcome>,
 *   close: (reason: string) => Promise<Outcome>,
 *   merge: (intoId: string) => Promise<Outcome>,
 *   split: (reportIds: string[]) => Promise<Outcome>,
 * }} IncidentActions
 */

/**
 * Only the actions the current status allows (dispatch.py's state machine),
 * with exactly one yellow plate: the next step in the normal flow.
 *
 * @param {{
 *   incident: import('../api.js').IncidentDetail,
 *   candidateTeams: import('../api.js').CandidateTeam[],
 *   nearby: import('../api.js').NearbyIncident[],
 *   selectedReports: string[], onClearSelection: () => void,
 *   mergeTarget: string | null, onMergeTargetChange: (id: string | null) => void,
 *   actions: IncidentActions,
 * }} props
 */
export default function ActionsPanel({
  incident,
  candidateTeams,
  nearby,
  selectedReports,
  onClearSelection,
  mergeTarget,
  onMergeTargetChange,
  actions,
}) {
  const { item } = incident
  const allowed = allowedActions(item.status)
  const reference = shortRef(item.id)
  const teamName = item.assigned_team?.name ?? null

  if (incident.merged_into_id || item.status === 'closed_duplicate') {
    return (
      <Plate title="Actions">
        <p className="text-sm">
          Nothing to do here. This incident was merged into{' '}
          {incident.merged_into_id ? (
            <Link to={`/staff/incidents/${incident.merged_into_id}`} className="font-mono font-semibold underline decoration-2 underline-offset-2">
              {shortRef(incident.merged_into_id)}
            </Link>
          ) : (
            'another incident'
          )}
          ; act on that one.
        </p>
      </Plate>
    )
  }
  if (item.status === 'resolved' || item.status === 'closed_invalid') {
    return (
      <Plate title="Actions">
        <p className="text-sm">
          {item.status === 'resolved'
            ? `Resolved${incident.resolved_at ? ` ${formatDateTime(incident.resolved_at)}` : ''}. No further actions.`
            : 'Closed as invalid. No further actions.'}
        </p>
      </Plate>
    )
  }

  // The one primary (yellow) action: the next step in the normal flow.
  const primary = !item.issue_type
    ? 'triage'
    : item.status === 'new' || item.status === 'triaged'
      ? 'assign'
      : item.status === 'assigned'
        ? 'on_site'
        : 'resolve'

  return (
    <div className="space-y-3">
      {allowed.triage && (
        <TriageAction
          key={`${item.issue_type}-${item.status}`}
          status={item.status}
          currentType={item.issue_type}
          suggestedType={suggestedIssueType(incident.reports)}
          primary={primary === 'triage'}
          onTriage={actions.triage}
        />
      )}
      {allowed.assign && (
        <AssignAction
          key={`${item.issue_type}-${item.assigned_team?.id ?? 'none'}`}
          incidentId={item.id}
          issueType={item.issue_type}
          teams={candidateTeams}
          currentTeam={item.assigned_team}
          primary={primary === 'assign'}
          onAssign={actions.assign}
        />
      )}
      <ProgressActions
        key={item.status}
        canOnSite={allowed.onSite}
        canResolve={allowed.resolve}
        teamName={teamName}
        primary={primary === 'on_site' || primary === 'resolve' ? primary : null}
        onOnSite={actions.onSite}
        onResolve={actions.resolve}
      />
      <Plate title="Correct">
        <div className="space-y-2">
          {allowed.split && incident.reports.length > 1 && (
            <SplitAction
              key={selectedReports.join(',')}
              incidentId={item.id}
              issueType={item.issue_type}
              reportCount={incident.reports.length}
              selected={selectedReports}
              onClear={onClearSelection}
              onSplit={actions.split}
            />
          )}
          {allowed.merge && (
            <MergeAction
              incidentId={item.id}
              reportCount={incident.reports.length}
              teamName={teamName}
              nearby={nearby}
              target={mergeTarget}
              onTargetChange={onMergeTargetChange}
              onMerge={actions.merge}
            />
          )}
          {allowed.close && <CloseAction reference={reference} teamName={teamName} onClose={actions.close} />}
        </div>
      </Plate>
    </div>
  )
}
