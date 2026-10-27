CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','officer','customer')),
  branch_id uuid REFERENCES branches(id), customer_id uuid,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, nik_hash text UNIQUE,
  nik_last4 text, phone text, bank_name text, account_last4 text,
  branch_id uuid NOT NULL REFERENCES branches(id), created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_customer_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id);
  END IF;
END $$;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','manager','officer','customer'));
CREATE TABLE IF NOT EXISTS policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer UNIQUE NOT NULL,
  min_principal bigint NOT NULL, max_principal bigint NOT NULL,
  flat_interest_bps integer NOT NULL, min_weeks integer NOT NULL, max_weeks integer NOT NULL,
  min_months integer NOT NULL DEFAULT 1, max_months integer NOT NULL DEFAULT 12,
  late_fee_monthly_bps integer NOT NULL DEFAULT 500,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_principal > 0 AND max_principal >= min_principal AND flat_interest_bps >= 0)
);
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers(id),
  officer_id uuid NOT NULL REFERENCES users(id), branch_id uuid NOT NULL REFERENCES branches(id),
  policy_id uuid REFERENCES policy_versions(id), requested_principal bigint NOT NULL,
  approved_principal bigint, interest_amount bigint, term_weeks integer, term_months integer,
  repayment_frequency text NOT NULL DEFAULT 'weekly' CHECK (repayment_frequency IN ('weekly','monthly_first')),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','awaiting_signature','signed_pending_approval','rejected','approved','signed','release_authorized','transfer_initiated','active','paid_off','closed')),
  exception_reason text, submitted_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
  CHECK (requested_principal > 0)
);
ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS min_months integer NOT NULL DEFAULT 1;
ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS max_months integer NOT NULL DEFAULT 12;
ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS late_fee_monthly_bps integer NOT NULL DEFAULT 500;
ALTER TABLE applications ALTER COLUMN term_weeks DROP NOT NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS term_months integer;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS repayment_frequency text NOT NULL DEFAULT 'weekly';
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check CHECK (status IN ('submitted','awaiting_signature','signed_pending_approval','rejected','approved','signed','release_authorized','transfer_initiated','active','paid_off','closed'));
ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS weekly_rates jsonb NOT NULL DEFAULT '[{"weeks":4,"rateBps":2000},{"weeks":5,"rateBps":2500},{"weeks":6,"rateBps":3000}]';
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_repayment_frequency_check;
ALTER TABLE applications ADD CONSTRAINT applications_repayment_frequency_check CHECK (repayment_frequency IN ('weekly','monthly_first','weekly_from_approval'));
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_term_check;
ALTER TABLE applications ADD CONSTRAINT applications_term_check CHECK ((repayment_frequency IN ('weekly','weekly_from_approval') AND term_weeks IS NOT NULL) OR (repayment_frequency='monthly_first' AND term_months IS NOT NULL));
CREATE TABLE IF NOT EXISTS agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
  version integer NOT NULL, snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
  signed_at timestamptz, signed_by uuid REFERENCES users(id), signature_receipt text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(application_id,version)
);
CREATE TABLE IF NOT EXISTS installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
  sequence integer NOT NULL, due_at date NOT NULL, principal bigint NOT NULL, interest bigint NOT NULL,
  UNIQUE(application_id,sequence)
);
CREATE TABLE IF NOT EXISTS intake_evidence (
  application_id uuid PRIMARY KEY REFERENCES applications(id),
  details_cipher bytea NOT NULL, details_iv bytea NOT NULL, details_tag bytea NOT NULL,
  ktp_cipher bytea NOT NULL, ktp_iv bytea NOT NULL, ktp_tag bytea NOT NULL, ktp_mime text NOT NULL, ktp_sha256 text NOT NULL,
  liveness_cipher bytea NOT NULL, liveness_iv bytea NOT NULL, liveness_tag bytea NOT NULL, liveness_mime text NOT NULL, liveness_sha256 text NOT NULL,
  verification_status text NOT NULL DEFAULT 'manual_review_required',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signature_evidence (
  agreement_id uuid PRIMARY KEY REFERENCES agreements(id),
  signature_cipher bytea NOT NULL, signature_iv bytea NOT NULL, signature_tag bytea NOT NULL,
  signature_sha256 text NOT NULL, signer_name text NOT NULL,
  signing_method text NOT NULL CHECK (signing_method IN ('officer_device_demo','customer_session_demo')),
  witness_officer_id uuid REFERENCES users(id), terms_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid UNIQUE NOT NULL REFERENCES applications(id),
  idempotency_key text UNIQUE NOT NULL, authorized_by uuid NOT NULL REFERENCES users(id),
  initiated_at timestamptz NOT NULL DEFAULT now(), bank_reference text UNIQUE,
  proof text, confirmed_by uuid REFERENCES users(id), confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
  bank_reference text UNIQUE NOT NULL, amount bigint NOT NULL CHECK (amount > 0),
  principal bigint NOT NULL, interest bigint NOT NULL, verified_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payments ALTER COLUMN bank_reference DROP NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_source text NOT NULL DEFAULT 'entered';
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_source_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_source_check CHECK (amount_source IN ('entered','read_confirmed','read_auto'));
CREATE TABLE IF NOT EXISTS payment_receipts (
  payment_id uuid PRIMARY KEY REFERENCES payments(id),
  receipt_cipher bytea NOT NULL, receipt_iv bytea NOT NULL, receipt_tag bytea NOT NULL,
  receipt_mime text NOT NULL, receipt_sha256 text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
  event_type text NOT NULL, source_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journal_lines (
  journal_id uuid NOT NULL REFERENCES journals(id), account text NOT NULL,
  debit bigint NOT NULL DEFAULT 0, credit bigint NOT NULL DEFAULT 0,
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), subject_type text NOT NULL,
  subject_id uuid NOT NULL, action text NOT NULL, before_data jsonb, after_data jsonb,
  reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS location_shares (
  customer_id uuid PRIMARY KEY REFERENCES customers(id),
  enabled boolean NOT NULL DEFAULT false,
  consented_at timestamptz,
  stopped_at timestamptz,
  latitude numeric(6,3),
  longitude numeric(6,3),
  accuracy_m integer,
  reported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CHECK (accuracy_m IS NULL OR accuracy_m >= 0)
);
CREATE TABLE IF NOT EXISTS mobile_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
  customer_id uuid NOT NULL REFERENCES customers(id), code_hash text UNIQUE NOT NULL,
  issued_by uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mobile_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers(id),
  enrollment_id uuid NOT NULL REFERENCES mobile_enrollments(id), token_hash text UNIQUE NOT NULL,
  sharing_enabled boolean NOT NULL DEFAULT false, consented_at timestamptz,
  revoked_at timestamptz, last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mobile_devices_current_customer_idx ON mobile_devices(customer_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS mobile_enrollments_customer_idx ON mobile_enrollments(customer_id,expires_at);
CREATE INDEX IF NOT EXISTS applications_officer_idx ON applications(officer_id,status);
CREATE INDEX IF NOT EXISTS applications_branch_idx ON applications(branch_id,status);
CREATE INDEX IF NOT EXISTS audit_subject_idx ON audit_events(subject_type,subject_id);
