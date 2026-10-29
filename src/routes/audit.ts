import { Router } from 'express';
import { authenticate, requireRole } from '../auth';
import { pool } from '../db/pool';
import { handle } from '../errors';

export const auditRouter = Router();

/** VP-185: Auditors and Finance Approvers can read the audit trail, newest first. */
auditRouter.get('/', authenticate, requireRole('AUDITOR', 'FINANCE_APPROVER'), handle(async (req, res) => {
  const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : null;
  const type = typeof req.query.type === 'string' ? req.query.type : null;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
  const r = await pool.query(
    `SELECT id, type, actor, entity_type, entity_id, details, created_at FROM audit_events
     WHERE ($1::text IS NULL OR entity_id = $1) AND ($2::text IS NULL OR type = $2)
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [entityId, type, limit]);
  res.json({
    events: r.rows.map((e) => ({
      id: Number(e.id), type: e.type, actor: e.actor, entityType: e.entity_type, entityId: e.entity_id, details: e.details, createdAt: e.created_at,
    })),
  });
}));
