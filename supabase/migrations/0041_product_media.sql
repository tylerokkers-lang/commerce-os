-- =============================================================================
-- 0041_product_media.sql
-- Product Media Intelligence (Phase 7 of the customer-facing store,
-- following Phase 6's controlled Shopify publication).
--
-- Audited first: no product image/media table or column exists anywhere
-- in this schema (`products` has no image column; confirmed by
-- inspection during Phase 6, which is exactly why Phase 6's eligibility
-- check honestly hardcoded `imageCount: 0`). This is a genuine gap, not
-- something to force onto an existing table — `product_media` is the one
-- new table this milestone adds.
--
-- Deliberately reuses rather than duplicates:
--   - `supplier_products`/`suppliers` (Milestone 1) for the supplier
--     link — no new supplier concept.
--   - `product_variants` (Milestone 1) for variant association.
--   - `audit_logs` (Milestone 1) for every important media decision —
--     no second, media-specific history table. `product_media` itself is
--     mutable current-state (an image can be re-scored, approved,
--     rejected, or removed), not append-only, exactly like
--     `channel_products`.
--   - `business_settings.min_product_images` (Phase 6, 0040) for "how
--     many approved images are required" — not duplicated as a second
--     "min_approved_images" column.
-- =============================================================================

create type media_type as enum ('image', 'video', 'document');

create type media_role as enum (
  'primary', 'secondary', 'product_detail', 'lifestyle',
  'packaging', 'dimensions', 'variant', 'instructional'
);

-- The sourcing hierarchy (Level 1-4 in the brief), in priority order.
create type media_source_type as enum (
  'supplier_provided', 'manufacturer_provided', 'user_provided', 'other_unverified'
);

-- What we can actually claim about where the rights to use this image
-- come from — never stronger than the source type actually supports.
create type media_provenance_status as enum (
  'verified_supplier', 'verified_manufacturer', 'user_provided_unverified_rights', 'unverified_source'
);

-- A deterministic checklist state, reused for quality/format/size and
-- for product-match — never collapsed with the final validation_status.
create type media_check_status as enum ('pass', 'review_required', 'fail', 'not_assessed');

-- Watermark/branding detection is explicitly NOT computer vision (see
-- HANDOVER.md) — `not_detected` is deliberately absent from this enum.
-- A clean deterministic check that finds nothing can only ever report
-- `uncertain`, never claim absence, per the brief's own explicit rule.
create type media_watermark_status as enum ('detected', 'uncertain');

create type media_product_match_status as enum ('matched', 'mismatched', 'uncertain');

-- The final, single verdict a caller (Shopify publication or any future
-- marketplace) actually consumes.
create type media_validation_status as enum ('approved', 'review_required', 'rejected');

create table product_media (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_product_id uuid references supplier_products(id) on delete set null,

  media_type media_type not null default 'image',
  role       media_role not null default 'secondary',
  "position" int not null default 0,

  media_url  text not null,
  source_url text,
  source_type media_source_type not null,
  -- Free text rather than an enum: 'supplier_candidate_capture',
  -- 'manual_attach' today; a future connector's own key once one
  -- genuinely implements `readProductMedia`, without a migration.
  discovery_method text not null,

  width  int,
  height int,
  file_size_bytes int,
  format text,
  checksum text,

  provenance_status media_provenance_status not null,

  quality_status media_check_status not null default 'not_assessed',
  quality_score  int check (quality_score is null or quality_score between 0 and 100),
  quality_components jsonb not null default '[]'::jsonb,

  watermark_status media_watermark_status,
  watermark_detail text,

  product_match_status media_product_match_status not null default 'uncertain',
  product_match_detail text,

  validation_status media_validation_status not null default 'review_required',
  validation_reason text not null default 'Not yet validated.',
  rejection_reason  text,

  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,

  discovered_at   timestamptz not null default now(),
  validated_at    timestamptz,
  last_checked_at timestamptz,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_media_product_idx on product_media(org_id, product_id);
create index product_media_validation_idx on product_media(org_id, validation_status);
create index product_media_checksum_idx on product_media(org_id, checksum);

create trigger product_media_touch before update on product_media
  for each row execute function touch_updated_at();

-- -----------------------------------------------------------------------------
-- Settings this milestone genuinely needs. `min_product_images`
-- (0040, Phase 6) already covers "how many approved images are required"
-- and is reused unchanged.
-- -----------------------------------------------------------------------------

alter table business_settings
  add column min_image_width_px int not null default 800 check (min_image_width_px > 0),
  add column min_image_height_px int not null default 800 check (min_image_height_px > 0),
  add column max_image_file_size_bytes bigint not null default 5242880 check (max_image_file_size_bytes > 0), -- 5MB
  add column allowed_image_formats text[] not null default '{jpeg,png,webp}';
