CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','officer','customer')),
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
CREATE TABLE IF NOT EXISTS policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer UNIQUE NOT NULL,
  min_principal bigint NOT NULL, max_principal bigint NOT NULL,
  flat_interest_bps integer NOT NULL, min_weeks integer NOT NULL, max_weeks integer NOT NULL,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_principal > 0 AND max_principal >= min_principal AND flat_interest_bps >= 0)
);
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers(id),
  officer_id uuid NOT NULL REFERENCES users(id), branch_id uuid NOT NULL REFERENCES branches(id),
  policy_id uuid REFERENCES policy_versions(id), requested_principal bigint NOT NULL,
  approved_principal bigint, interest_amount bigint, term_weeks integer NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','rejected','approved','signed','release_authorized','transfer_initiated','active','paid_off','closed')),
  exception_reason text, submitted_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
  CHECK (requested_principal > 0)
);
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
CREATE INDEX IF NOT EXISTS applications_officer_idx ON applications(officer_id,status);
CREATE INDEX IF NOT EXISTS applications_branch_idx ON applications(branch_id,status);
CREATE INDEX IF NOT EXISTS audit_subject_idx ON audit_events(subject_type,subject_id);
