// GENERATED FILE - do not edit by hand.
// Regenerate with: npm run db:types
// Source of truth: supabase/migrations/*.sql

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      accounting_sync: {
        Row: {
          id: string
          org_id: string
          provider: string
          entity_type: string
          entity_id: string
          external_id: string | null
          status: string
          attempts: number
          last_error: string | null
          synced_at: string | null
          next_retry_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          provider?: string
          entity_type: string
          entity_id: string
          external_id?: string | null
          status?: string
          attempts?: number
          last_error?: string | null
          synced_at?: string | null
          next_retry_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          provider?: string
          entity_type?: string
          entity_id?: string
          external_id?: string | null
          status?: string
          attempts?: number
          last_error?: string | null
          synced_at?: string | null
          next_retry_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'accounting_sync_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      addresses: {
        Row: {
          id: string
          org_id: string
          customer_id: string | null
          name: string | null
          company: string | null
          line1: string | null
          line2: string | null
          city: string | null
          region: string | null
          postcode: string | null
          country: string
          phone: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          customer_id?: string | null
          name?: string | null
          company?: string | null
          line1?: string | null
          line2?: string | null
          city?: string | null
          region?: string | null
          postcode?: string | null
          country?: string
          phone?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          customer_id?: string | null
          name?: string | null
          company?: string | null
          line1?: string | null
          line2?: string | null
          city?: string | null
          region?: string | null
          postcode?: string | null
          country?: string
          phone?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'addresses_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'addresses_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      advertising: {
        Row: {
          id: string
          org_id: string
          channel: Database['public']['Enums']['channel_key']
          product_id: string | null
          campaign_name: string | null
          external_id: string | null
          period_date: string
          spend_minor: number
          revenue_minor: number
          clicks: number
          impressions: number
          conversions: number
          daily_budget_minor: number | null
          is_paused: boolean
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          channel: Database['public']['Enums']['channel_key']
          product_id?: string | null
          campaign_name?: string | null
          external_id?: string | null
          period_date: string
          spend_minor?: number
          revenue_minor?: number
          clicks?: number
          impressions?: number
          conversions?: number
          daily_budget_minor?: number | null
          is_paused?: boolean
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          channel?: Database['public']['Enums']['channel_key']
          product_id?: string | null
          campaign_name?: string | null
          external_id?: string | null
          period_date?: string
          spend_minor?: number
          revenue_minor?: number
          clicks?: number
          impressions?: number
          conversions?: number
          daily_budget_minor?: number | null
          is_paused?: boolean
          is_demo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'advertising_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'advertising_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      ai_decisions: {
        Row: {
          id: string
          org_id: string
          decision_type: string
          entity_type: string
          entity_id: string | null
          status: Database['public']['Enums']['decision_status']
          inputs: Json
          recommendation: Json
          reasoning: string
          confidence: number | null
          rules_considered: string[]
          estimated_impact_minor: number | null
          automation_level_required: Database['public']['Enums']['automation_level']
          requires_owner_approval: boolean
          compliance_status: Database['public']['Enums']['compliance_verdict']
          model: string | null
          approved_by: string | null
          approved_at: string | null
          executed_at: string | null
          execution_error: string | null
          is_demo: boolean
          created_at: string
          expires_at: string | null
          risk_level: Database['public']['Enums']['automation_risk_level']
          action_payload: Json
        }
        Insert: {
          id?: string
          org_id: string
          decision_type: string
          entity_type: string
          entity_id?: string | null
          status?: Database['public']['Enums']['decision_status']
          inputs?: Json
          recommendation: Json
          reasoning: string
          confidence?: number | null
          rules_considered?: string[]
          estimated_impact_minor?: number | null
          automation_level_required?: Database['public']['Enums']['automation_level']
          requires_owner_approval?: boolean
          compliance_status?: Database['public']['Enums']['compliance_verdict']
          model?: string | null
          approved_by?: string | null
          approved_at?: string | null
          executed_at?: string | null
          execution_error?: string | null
          is_demo?: boolean
          created_at?: string
          expires_at?: string | null
          risk_level?: Database['public']['Enums']['automation_risk_level']
          action_payload?: Json
        }
        Update: {
          id?: string
          org_id?: string
          decision_type?: string
          entity_type?: string
          entity_id?: string | null
          status?: Database['public']['Enums']['decision_status']
          inputs?: Json
          recommendation?: Json
          reasoning?: string
          confidence?: number | null
          rules_considered?: string[]
          estimated_impact_minor?: number | null
          automation_level_required?: Database['public']['Enums']['automation_level']
          requires_owner_approval?: boolean
          compliance_status?: Database['public']['Enums']['compliance_verdict']
          model?: string | null
          approved_by?: string | null
          approved_at?: string | null
          executed_at?: string | null
          execution_error?: string | null
          is_demo?: boolean
          created_at?: string
          expires_at?: string | null
          risk_level?: Database['public']['Enums']['automation_risk_level']
          action_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'ai_decisions_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ai_decisions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      amazon_listings: {
        Row: {
          channel_product_id: string
          org_id: string
          asin: string | null
          seller_sku: string | null
          marketplace_id: string
          fulfilment_channel: string
          condition: string
          gtin_exempt: boolean
          browse_node: string | null
          updated_at: string
        }
        Insert: {
          channel_product_id: string
          org_id: string
          asin?: string | null
          seller_sku?: string | null
          marketplace_id?: string
          fulfilment_channel?: string
          condition?: string
          gtin_exempt?: boolean
          browse_node?: string | null
          updated_at?: string
        }
        Update: {
          channel_product_id?: string
          org_id?: string
          asin?: string | null
          seller_sku?: string | null
          marketplace_id?: string
          fulfilment_channel?: string
          condition?: string
          gtin_exempt?: boolean
          browse_node?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'amazon_listings_channel_product_id_fkey'
            columns: ['channel_product_id']
            isOneToOne: true
            referencedRelation: 'channel_products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'amazon_listings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          id: number
          org_id: string
          occurred_at: string
          actor_type: Database['public']['Enums']['actor_type']
          actor_user_id: string | null
          actor_label: string | null
          action: string
          entity_type: string
          entity_id: string | null
          previous_value: Json | null
          new_value: Json | null
          reason: string | null
          rule_key: string | null
          ai_decision_id: string | null
          result: string
          error: string | null
          metadata: Json
        }
        Insert: {
          id?: number
          org_id: string
          occurred_at?: string
          actor_type: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          previous_value?: Json | null
          new_value?: Json | null
          reason?: string | null
          rule_key?: string | null
          ai_decision_id?: string | null
          result?: string
          error?: string | null
          metadata?: Json
        }
        Update: {
          id?: number
          org_id?: string
          occurred_at?: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          action?: string
          entity_type?: string
          entity_id?: string | null
          previous_value?: Json | null
          new_value?: Json | null
          reason?: string | null
          rule_key?: string | null
          ai_decision_id?: string | null
          result?: string
          error?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_logs_ai_decision_fk'
            columns: ['ai_decision_id']
            isOneToOne: false
            referencedRelation: 'ai_decisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_logs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      automation_actions: {
        Row: {
          id: string
          org_id: string
          correlation_id: string
          idempotency_key: string | null
          action_type: Database['public']['Enums']['automation_action_type']
          entity_type: string
          entity_id: string | null
          reason: string
          input_facts: Json
          decision: Json
          policy_result: Json
          automation_level: Database['public']['Enums']['automation_level']
          risk_level: Database['public']['Enums']['automation_risk_level']
          expected_outcome: string | null
          status: Database['public']['Enums']['automation_action_status']
          error: string | null
          actor_type: Database['public']['Enums']['actor_type']
          ai_decision_id: string | null
          job_id: string | null
          is_demo: boolean
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          correlation_id?: string
          idempotency_key?: string | null
          action_type: Database['public']['Enums']['automation_action_type']
          entity_type: string
          entity_id?: string | null
          reason: string
          input_facts?: Json
          decision?: Json
          policy_result?: Json
          automation_level: Database['public']['Enums']['automation_level']
          risk_level?: Database['public']['Enums']['automation_risk_level']
          expected_outcome?: string | null
          status?: Database['public']['Enums']['automation_action_status']
          error?: string | null
          actor_type?: Database['public']['Enums']['actor_type']
          ai_decision_id?: string | null
          job_id?: string | null
          is_demo?: boolean
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          correlation_id?: string
          idempotency_key?: string | null
          action_type?: Database['public']['Enums']['automation_action_type']
          entity_type?: string
          entity_id?: string | null
          reason?: string
          input_facts?: Json
          decision?: Json
          policy_result?: Json
          automation_level?: Database['public']['Enums']['automation_level']
          risk_level?: Database['public']['Enums']['automation_risk_level']
          expected_outcome?: string | null
          status?: Database['public']['Enums']['automation_action_status']
          error?: string | null
          actor_type?: Database['public']['Enums']['actor_type']
          ai_decision_id?: string | null
          job_id?: string | null
          is_demo?: boolean
          created_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'automation_actions_ai_decision_id_fkey'
            columns: ['ai_decision_id']
            isOneToOne: false
            referencedRelation: 'ai_decisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'automation_actions_job_fk'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'automation_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'automation_actions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      automation_jobs: {
        Row: {
          id: string
          org_id: string
          job_type: string
          status: Database['public']['Enums']['automation_job_status']
          payload: Json
          run_at: string
          idempotency_key: string | null
          attempts: number
          max_attempts: number
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          correlation_id: string
          created_at: string
          updated_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          job_type: string
          status?: Database['public']['Enums']['automation_job_status']
          payload?: Json
          run_at?: string
          idempotency_key?: string | null
          attempts?: number
          max_attempts?: number
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          correlation_id?: string
          created_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          job_type?: string
          status?: Database['public']['Enums']['automation_job_status']
          payload?: Json
          run_at?: string
          idempotency_key?: string | null
          attempts?: number
          max_attempts?: number
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          correlation_id?: string
          created_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'automation_jobs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      automation_rules: {
        Row: {
          id: string
          org_id: string
          rule_key: string
          label: string
          description: string | null
          category: string
          is_enabled: boolean
          conditions: Json
          actions: Json
          required_level: Database['public']['Enums']['automation_level']
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          rule_key: string
          label: string
          description?: string | null
          category: string
          is_enabled?: boolean
          conditions?: Json
          actions?: Json
          required_level?: Database['public']['Enums']['automation_level']
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          rule_key?: string
          label?: string
          description?: string | null
          category?: string
          is_enabled?: boolean
          conditions?: Json
          actions?: Json
          required_level?: Database['public']['Enums']['automation_level']
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'automation_rules_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      automation_runs: {
        Row: {
          id: string
          org_id: string
          job_key: string
          status: string
          started_at: string
          finished_at: string | null
          duration_ms: number | null
          items_processed: number
          items_failed: number
          decisions_created: number
          error: string | null
          summary: Json
          idempotency_key: string | null
        }
        Insert: {
          id?: string
          org_id: string
          job_key: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          items_processed?: number
          items_failed?: number
          decisions_created?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          job_key?: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          items_processed?: number
          items_failed?: number
          decisions_created?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'automation_runs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      business_settings: {
        Row: {
          org_id: string
          legal_name: string | null
          trading_name: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          postcode: string | null
          country: string
          email: string | null
          phone: string | null
          website: string | null
          company_number: string | null
          vat_registered: boolean
          vat_number: string | null
          vat_registered_from: string | null
          vat_scheme: string | null
          logo_path: string | null
          favicon_path: string | null
          brand_primary: string
          brand_accent: string
          invoice_footer: string | null
          invoice_terms: string | null
          invoice_prefix: string
          invoice_next_number: number
          credit_note_prefix: string
          credit_note_next_number: number
          automation_level: Database['public']['Enums']['automation_level']
          min_gross_margin_pct: number
          min_net_margin_pct: number
          min_opportunity_score: number
          max_auto_purchase_minor: number
          max_auto_price_change_pct: number
          max_daily_ad_spend_minor: number
          max_auto_ad_increase_pct: number
          min_roas: number
          max_delivery_days: number
          max_return_rate_pct: number
          blocked_categories: string[]
          allowed_categories: string[]
          preferred_countries: string[]
          created_at: string
          updated_at: string
          max_auto_refund_minor: number
          automation_paused: boolean
          automation_paused_at: string | null
          automation_paused_reason: string | null
          automation_paused_categories: string[]
          max_daily_auto_refund_minor: number
          max_refunds_per_order: number
          max_daily_auto_supplier_spend_minor: number
          max_auto_supplier_switch_cost_increase_pct: number
          max_price_movement_per_day_pct: number
        }
        Insert: {
          org_id: string
          legal_name?: string | null
          trading_name?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          postcode?: string | null
          country?: string
          email?: string | null
          phone?: string | null
          website?: string | null
          company_number?: string | null
          vat_registered?: boolean
          vat_number?: string | null
          vat_registered_from?: string | null
          vat_scheme?: string | null
          logo_path?: string | null
          favicon_path?: string | null
          brand_primary?: string
          brand_accent?: string
          invoice_footer?: string | null
          invoice_terms?: string | null
          invoice_prefix?: string
          invoice_next_number?: number
          credit_note_prefix?: string
          credit_note_next_number?: number
          automation_level?: Database['public']['Enums']['automation_level']
          min_gross_margin_pct?: number
          min_net_margin_pct?: number
          min_opportunity_score?: number
          max_auto_purchase_minor?: number
          max_auto_price_change_pct?: number
          max_daily_ad_spend_minor?: number
          max_auto_ad_increase_pct?: number
          min_roas?: number
          max_delivery_days?: number
          max_return_rate_pct?: number
          blocked_categories?: string[]
          allowed_categories?: string[]
          preferred_countries?: string[]
          created_at?: string
          updated_at?: string
          max_auto_refund_minor?: number
          automation_paused?: boolean
          automation_paused_at?: string | null
          automation_paused_reason?: string | null
          automation_paused_categories?: string[]
          max_daily_auto_refund_minor?: number
          max_refunds_per_order?: number
          max_daily_auto_supplier_spend_minor?: number
          max_auto_supplier_switch_cost_increase_pct?: number
          max_price_movement_per_day_pct?: number
        }
        Update: {
          org_id?: string
          legal_name?: string | null
          trading_name?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          postcode?: string | null
          country?: string
          email?: string | null
          phone?: string | null
          website?: string | null
          company_number?: string | null
          vat_registered?: boolean
          vat_number?: string | null
          vat_registered_from?: string | null
          vat_scheme?: string | null
          logo_path?: string | null
          favicon_path?: string | null
          brand_primary?: string
          brand_accent?: string
          invoice_footer?: string | null
          invoice_terms?: string | null
          invoice_prefix?: string
          invoice_next_number?: number
          credit_note_prefix?: string
          credit_note_next_number?: number
          automation_level?: Database['public']['Enums']['automation_level']
          min_gross_margin_pct?: number
          min_net_margin_pct?: number
          min_opportunity_score?: number
          max_auto_purchase_minor?: number
          max_auto_price_change_pct?: number
          max_daily_ad_spend_minor?: number
          max_auto_ad_increase_pct?: number
          min_roas?: number
          max_delivery_days?: number
          max_return_rate_pct?: number
          blocked_categories?: string[]
          allowed_categories?: string[]
          preferred_countries?: string[]
          created_at?: string
          updated_at?: string
          max_auto_refund_minor?: number
          automation_paused?: boolean
          automation_paused_at?: string | null
          automation_paused_reason?: string | null
          automation_paused_categories?: string[]
          max_daily_auto_refund_minor?: number
          max_refunds_per_order?: number
          max_daily_auto_supplier_spend_minor?: number
          max_auto_supplier_switch_cost_increase_pct?: number
          max_price_movement_per_day_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: 'business_settings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      channel_discrepancies: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          channel_product_id: string | null
          order_id: string | null
          sync_run_id: string | null
          field: Database['public']['Enums']['discrepancy_field']
          our_value: string
          marketplace_value: string
          our_recorded_at: string
          marketplace_reported_at: string
          status: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          detected_at: string
        }
        Insert: {
          id?: string
          org_id: string
          channel_id: string
          channel_product_id?: string | null
          order_id?: string | null
          sync_run_id?: string | null
          field: Database['public']['Enums']['discrepancy_field']
          our_value: string
          marketplace_value: string
          our_recorded_at: string
          marketplace_reported_at: string
          status?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          detected_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          channel_id?: string
          channel_product_id?: string | null
          order_id?: string | null
          sync_run_id?: string | null
          field?: Database['public']['Enums']['discrepancy_field']
          our_value?: string
          marketplace_value?: string
          our_recorded_at?: string
          marketplace_reported_at?: string
          status?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          detected_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'channel_discrepancies_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_discrepancies_channel_product_id_fkey'
            columns: ['channel_product_id']
            isOneToOne: false
            referencedRelation: 'channel_products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_discrepancies_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_discrepancies_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_discrepancies_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_discrepancies_sync_run_id_fkey'
            columns: ['sync_run_id']
            isOneToOne: false
            referencedRelation: 'channel_sync_runs'
            referencedColumns: ['id']
          },
        ]
      }
      channel_listing_transitions: {
        Row: {
          id: number
          org_id: string
          channel_product_id: string
          from_state: Database['public']['Enums']['marketplace_listing_state'] | null
          to_state: Database['public']['Enums']['marketplace_listing_state']
          reason: string
          actor_type: Database['public']['Enums']['actor_type']
          actor_user_id: string | null
          actor_label: string | null
          evidence: Json
          ai_decision_id: string | null
          occurred_at: string
        }
        Insert: {
          id?: number
          org_id: string
          channel_product_id: string
          from_state?: Database['public']['Enums']['marketplace_listing_state'] | null
          to_state: Database['public']['Enums']['marketplace_listing_state']
          reason: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Update: {
          id?: number
          org_id?: string
          channel_product_id?: string
          from_state?: Database['public']['Enums']['marketplace_listing_state'] | null
          to_state?: Database['public']['Enums']['marketplace_listing_state']
          reason?: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'channel_listing_transitions_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_listing_transitions_ai_decision_id_fkey'
            columns: ['ai_decision_id']
            isOneToOne: false
            referencedRelation: 'ai_decisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_listing_transitions_channel_product_id_fkey'
            columns: ['channel_product_id']
            isOneToOne: false
            referencedRelation: 'channel_products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_listing_transitions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      channel_products: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          product_id: string
          variant_id: string | null
          status: Database['public']['Enums']['channel_listing_status']
          status_reason: string | null
          external_id: string | null
          external_sku: string | null
          listing_url: string | null
          price_minor: number | null
          compare_at_minor: number | null
          min_price_minor: number | null
          currency: string
          fulfilment_supplier_id: string | null
          last_synced_at: string | null
          sync_error: string | null
          is_demo: boolean
          created_at: string
          updated_at: string
          workflow_state: Database['public']['Enums']['marketplace_listing_state']
        }
        Insert: {
          id?: string
          org_id: string
          channel_id: string
          product_id: string
          variant_id?: string | null
          status?: Database['public']['Enums']['channel_listing_status']
          status_reason?: string | null
          external_id?: string | null
          external_sku?: string | null
          listing_url?: string | null
          price_minor?: number | null
          compare_at_minor?: number | null
          min_price_minor?: number | null
          currency?: string
          fulfilment_supplier_id?: string | null
          last_synced_at?: string | null
          sync_error?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          workflow_state?: Database['public']['Enums']['marketplace_listing_state']
        }
        Update: {
          id?: string
          org_id?: string
          channel_id?: string
          product_id?: string
          variant_id?: string | null
          status?: Database['public']['Enums']['channel_listing_status']
          status_reason?: string | null
          external_id?: string | null
          external_sku?: string | null
          listing_url?: string | null
          price_minor?: number | null
          compare_at_minor?: number | null
          min_price_minor?: number | null
          currency?: string
          fulfilment_supplier_id?: string | null
          last_synced_at?: string | null
          sync_error?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          workflow_state?: Database['public']['Enums']['marketplace_listing_state']
        }
        Relationships: [
          {
            foreignKeyName: 'channel_products_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_products_fulfilment_supplier_id_fkey'
            columns: ['fulfilment_supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_products_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_products_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_products_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
        ]
      }
      channel_sync_runs: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          sync_type: string
          status: string
          started_at: string
          finished_at: string | null
          duration_ms: number | null
          items_checked: number
          items_updated: number
          discrepancies_found: number
          requests_made: number
          error: string | null
          summary: Json
          idempotency_key: string | null
        }
        Insert: {
          id?: string
          org_id: string
          channel_id: string
          sync_type: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          items_checked?: number
          items_updated?: number
          discrepancies_found?: number
          requests_made?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          channel_id?: string
          sync_type?: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          items_checked?: number
          items_updated?: number
          discrepancies_found?: number
          requests_made?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'channel_sync_runs_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_sync_runs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      channel_webhook_events: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          event_type: string
          external_event_id: string
          payload: Json
          status: string
          received_at: string
          processed_at: string | null
          error: string | null
        }
        Insert: {
          id?: string
          org_id: string
          channel_id: string
          event_type: string
          external_event_id: string
          payload: Json
          status?: string
          received_at?: string
          processed_at?: string | null
          error?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          channel_id?: string
          event_type?: string
          external_event_id?: string
          payload?: Json
          status?: string
          received_at?: string
          processed_at?: string | null
          error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'channel_webhook_events_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_webhook_events_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      channels: {
        Row: {
          id: string
          org_id: string
          key: Database['public']['Enums']['channel_key']
          label: string
          is_enabled: boolean
          is_connected: boolean
          connection_mode: string
          last_success_at: string | null
          last_failure_at: string | null
          last_error: string | null
          next_retry_at: string | null
          created_at: string
          updated_at: string
          status: Database['public']['Enums']['marketplace_connection_status']
          api_version: string | null
          rate_limit_per_minute: number | null
          consecutive_failures: number
          cached_listing_count: number
          cached_order_count: number
          webhook_endpoint_configured: boolean
        }
        Insert: {
          id?: string
          org_id: string
          key: Database['public']['Enums']['channel_key']
          label: string
          is_enabled?: boolean
          is_connected?: boolean
          connection_mode?: string
          last_success_at?: string | null
          last_failure_at?: string | null
          last_error?: string | null
          next_retry_at?: string | null
          created_at?: string
          updated_at?: string
          status?: Database['public']['Enums']['marketplace_connection_status']
          api_version?: string | null
          rate_limit_per_minute?: number | null
          consecutive_failures?: number
          cached_listing_count?: number
          cached_order_count?: number
          webhook_endpoint_configured?: boolean
        }
        Update: {
          id?: string
          org_id?: string
          key?: Database['public']['Enums']['channel_key']
          label?: string
          is_enabled?: boolean
          is_connected?: boolean
          connection_mode?: string
          last_success_at?: string | null
          last_failure_at?: string | null
          last_error?: string | null
          next_retry_at?: string | null
          created_at?: string
          updated_at?: string
          status?: Database['public']['Enums']['marketplace_connection_status']
          api_version?: string | null
          rate_limit_per_minute?: number | null
          consecutive_failures?: number
          cached_listing_count?: number
          cached_order_count?: number
          webhook_endpoint_configured?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'channels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      compliance_documents: {
        Row: {
          id: string
          org_id: string
          compliance_record_id: string | null
          product_id: string | null
          doc_type: string
          title: string
          storage_path: string | null
          issued_on: string | null
          expires_on: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          compliance_record_id?: string | null
          product_id?: string | null
          doc_type: string
          title: string
          storage_path?: string | null
          issued_on?: string | null
          expires_on?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          compliance_record_id?: string | null
          product_id?: string | null
          doc_type?: string
          title?: string
          storage_path?: string | null
          issued_on?: string | null
          expires_on?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'compliance_documents_compliance_record_id_fkey'
            columns: ['compliance_record_id']
            isOneToOne: false
            referencedRelation: 'compliance_records'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compliance_documents_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compliance_documents_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      compliance_records: {
        Row: {
          id: string
          org_id: string
          product_id: string
          channel: Database['public']['Enums']['channel_key']
          verdict: Database['public']['Enums']['compliance_verdict']
          checks: Json
          blocking_reasons: string[]
          ruleset_version: string
          supplier_id: string | null
          ip_risk: string
          restricted_category: boolean
          requires_documentation: boolean
          assessed_at: string
          assessed_by: Database['public']['Enums']['actor_type']
          reviewed_by: string | null
          reviewed_at: string | null
          review_notes: string | null
          is_demo: boolean
          ip_risk_reasons: string[]
          ip_assessed_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          channel: Database['public']['Enums']['channel_key']
          verdict?: Database['public']['Enums']['compliance_verdict']
          checks?: Json
          blocking_reasons?: string[]
          ruleset_version: string
          supplier_id?: string | null
          ip_risk?: string
          restricted_category?: boolean
          requires_documentation?: boolean
          assessed_at?: string
          assessed_by?: Database['public']['Enums']['actor_type']
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          is_demo?: boolean
          ip_risk_reasons?: string[]
          ip_assessed_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          channel?: Database['public']['Enums']['channel_key']
          verdict?: Database['public']['Enums']['compliance_verdict']
          checks?: Json
          blocking_reasons?: string[]
          ruleset_version?: string
          supplier_id?: string | null
          ip_risk?: string
          restricted_category?: boolean
          requires_documentation?: boolean
          assessed_at?: string
          assessed_by?: Database['public']['Enums']['actor_type']
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          is_demo?: boolean
          ip_risk_reasons?: string[]
          ip_assessed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'compliance_records_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compliance_records_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compliance_records_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compliance_records_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      config_values: {
        Row: {
          org_id: string
          key: string
          value: Json
          description: string | null
          effective_from: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          org_id: string
          key: string
          value: Json
          description?: string | null
          effective_from?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          org_id?: string
          key?: string
          value?: Json
          description?: string | null
          effective_from?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'config_values_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'config_values_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      credit_notes: {
        Row: {
          id: string
          org_id: string
          invoice_id: string
          refund_id: string | null
          credit_note_number: string
          status: Database['public']['Enums']['invoice_status']
          issued_on: string
          reason: string | null
          lines: Json
          net_minor: number
          vat_minor: number
          gross_minor: number
          currency: string
          pdf_path: string | null
          sent_at: string | null
          idempotency_key: string
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          invoice_id: string
          refund_id?: string | null
          credit_note_number: string
          status?: Database['public']['Enums']['invoice_status']
          issued_on?: string
          reason?: string | null
          lines: Json
          net_minor?: number
          vat_minor?: number
          gross_minor?: number
          currency?: string
          pdf_path?: string | null
          sent_at?: string | null
          idempotency_key: string
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          invoice_id?: string
          refund_id?: string | null
          credit_note_number?: string
          status?: Database['public']['Enums']['invoice_status']
          issued_on?: string
          reason?: string | null
          lines?: Json
          net_minor?: number
          vat_minor?: number
          gross_minor?: number
          currency?: string
          pdf_path?: string | null
          sent_at?: string | null
          idempotency_key?: string
          is_demo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'credit_notes_invoice_id_fkey'
            columns: ['invoice_id']
            isOneToOne: false
            referencedRelation: 'invoices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'credit_notes_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'credit_notes_refund_id_fkey'
            columns: ['refund_id']
            isOneToOne: false
            referencedRelation: 'refunds'
            referencedColumns: ['id']
          },
        ]
      }
      customers: {
        Row: {
          id: string
          org_id: string
          email: string | null
          first_name: string | null
          last_name: string | null
          phone: string | null
          source_channel: Database['public']['Enums']['channel_key'] | null
          external_id: string | null
          is_demo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          email?: string | null
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          source_channel?: Database['public']['Enums']['channel_key'] | null
          external_id?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          email?: string | null
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          source_channel?: Database['public']['Enums']['channel_key'] | null
          external_id?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'customers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      differentiation_suggestions: {
        Row: {
          id: string
          org_id: string
          research_id: string | null
          product_id: string | null
          kind: Database['public']['Enums']['differentiation_kind']
          suggestion: string
          addresses_complaint: string | null
          evidence_strength: string
          estimated_cost_minor: number | null
          generated_by: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          research_id?: string | null
          product_id?: string | null
          kind: Database['public']['Enums']['differentiation_kind']
          suggestion: string
          addresses_complaint?: string | null
          evidence_strength?: string
          estimated_cost_minor?: number | null
          generated_by?: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          research_id?: string | null
          product_id?: string | null
          kind?: Database['public']['Enums']['differentiation_kind']
          suggestion?: string
          addresses_complaint?: string | null
          evidence_strength?: string
          estimated_cost_minor?: number | null
          generated_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'differentiation_suggestions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'differentiation_suggestions_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'differentiation_suggestions_research_id_fkey'
            columns: ['research_id']
            isOneToOne: false
            referencedRelation: 'product_research'
            referencedColumns: ['id']
          },
        ]
      }
      documents: {
        Row: {
          id: string
          org_id: string
          doc_type: string
          title: string
          storage_path: string
          mime_type: string | null
          size_bytes: number | null
          related_type: string | null
          related_id: string | null
          product_id: string | null
          supplier_id: string | null
          order_id: string | null
          is_demo: boolean
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          org_id: string
          doc_type: string
          title: string
          storage_path: string
          mime_type?: string | null
          size_bytes?: number | null
          related_type?: string | null
          related_id?: string | null
          product_id?: string | null
          supplier_id?: string | null
          order_id?: string | null
          is_demo?: boolean
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          doc_type?: string
          title?: string
          storage_path?: string
          mime_type?: string | null
          size_bytes?: number | null
          related_type?: string | null
          related_id?: string | null
          product_id?: string | null
          supplier_id?: string | null
          order_id?: string | null
          is_demo?: boolean
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'documents_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      expenses: {
        Row: {
          id: string
          org_id: string
          category: Database['public']['Enums']['expense_category']
          description: string
          incurred_on: string
          net_minor: number
          vat_minor: number
          gross_minor: number
          currency: string
          vat_reclaimable: boolean
          channel: Database['public']['Enums']['channel_key'] | null
          order_id: string | null
          product_id: string | null
          supplier_id: string | null
          source: string
          external_id: string | null
          document_path: string | null
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          category: Database['public']['Enums']['expense_category']
          description: string
          incurred_on?: string
          net_minor: number
          vat_minor?: number
          gross_minor: number
          currency?: string
          vat_reclaimable?: boolean
          channel?: Database['public']['Enums']['channel_key'] | null
          order_id?: string | null
          product_id?: string | null
          supplier_id?: string | null
          source?: string
          external_id?: string | null
          document_path?: string | null
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          category?: Database['public']['Enums']['expense_category']
          description?: string
          incurred_on?: string
          net_minor?: number
          vat_minor?: number
          gross_minor?: number
          currency?: string
          vat_reclaimable?: boolean
          channel?: Database['public']['Enums']['channel_key'] | null
          order_id?: string | null
          product_id?: string | null
          supplier_id?: string | null
          source?: string
          external_id?: string | null
          document_path?: string | null
          is_demo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expenses_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      fulfilment_items: {
        Row: {
          id: string
          org_id: string
          fulfilment_id: string
          order_item_id: string
          quantity: number
        }
        Insert: {
          id?: string
          org_id: string
          fulfilment_id: string
          order_item_id: string
          quantity: number
        }
        Update: {
          id?: string
          org_id?: string
          fulfilment_id?: string
          order_item_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fulfilment_items_fulfilment_id_fkey'
            columns: ['fulfilment_id']
            isOneToOne: false
            referencedRelation: 'fulfilments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fulfilment_items_order_item_id_fkey'
            columns: ['order_item_id']
            isOneToOne: false
            referencedRelation: 'order_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fulfilment_items_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      fulfilment_status_transitions: {
        Row: {
          id: number
          org_id: string
          fulfilment_id: string
          from_status: Database['public']['Enums']['fulfilment_status'] | null
          to_status: Database['public']['Enums']['fulfilment_status']
          reason: string
          actor_type: Database['public']['Enums']['actor_type']
          actor_user_id: string | null
          actor_label: string | null
          evidence: Json
          ai_decision_id: string | null
          occurred_at: string
        }
        Insert: {
          id?: number
          org_id: string
          fulfilment_id: string
          from_status?: Database['public']['Enums']['fulfilment_status'] | null
          to_status: Database['public']['Enums']['fulfilment_status']
          reason: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Update: {
          id?: number
          org_id?: string
          fulfilment_id?: string
          from_status?: Database['public']['Enums']['fulfilment_status'] | null
          to_status?: Database['public']['Enums']['fulfilment_status']
          reason?: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fulfilment_status_transitions_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fulfilment_status_transitions_ai_decision_id_fkey'
            columns: ['ai_decision_id']
            isOneToOne: false
            referencedRelation: 'ai_decisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fulfilment_status_transitions_fulfilment_id_fkey'
            columns: ['fulfilment_id']
            isOneToOne: false
            referencedRelation: 'fulfilments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fulfilment_status_transitions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      fulfilments: {
        Row: {
          id: string
          org_id: string
          order_id: string
          supplier_id: string | null
          status: Database['public']['Enums']['fulfilment_status']
          cost_minor: number
          shipping_cost_minor: number
          currency: string
          supplier_reference: string | null
          submitted_at: string | null
          shipped_at: string | null
          delivered_at: string | null
          failure_reason: string | null
          attempt_count: number
          idempotency_key: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          order_id: string
          supplier_id?: string | null
          status?: Database['public']['Enums']['fulfilment_status']
          cost_minor?: number
          shipping_cost_minor?: number
          currency?: string
          supplier_reference?: string | null
          submitted_at?: string | null
          shipped_at?: string | null
          delivered_at?: string | null
          failure_reason?: string | null
          attempt_count?: number
          idempotency_key: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          order_id?: string
          supplier_id?: string | null
          status?: Database['public']['Enums']['fulfilment_status']
          cost_minor?: number
          shipping_cost_minor?: number
          currency?: string
          supplier_reference?: string | null
          submitted_at?: string | null
          shipped_at?: string | null
          delivered_at?: string | null
          failure_reason?: string | null
          attempt_count?: number
          idempotency_key?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fulfilments_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fulfilments_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fulfilments_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      inventory: {
        Row: {
          id: string
          org_id: string
          product_id: string
          variant_id: string | null
          location: string
          on_hand_qty: number
          reserved_qty: number
          incoming_qty: number
          is_supplier_stocked: boolean
          reorder_point: number
          safety_stock: number
          reorder_quantity: number
          lead_time_days: number | null
          is_demo: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          variant_id?: string | null
          location?: string
          on_hand_qty?: number
          reserved_qty?: number
          incoming_qty?: number
          is_supplier_stocked?: boolean
          reorder_point?: number
          safety_stock?: number
          reorder_quantity?: number
          lead_time_days?: number | null
          is_demo?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          variant_id?: string | null
          location?: string
          on_hand_qty?: number
          reserved_qty?: number
          incoming_qty?: number
          is_supplier_stocked?: boolean
          reorder_point?: number
          safety_stock?: number
          reorder_quantity?: number
          lead_time_days?: number | null
          is_demo?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_movements: {
        Row: {
          id: number
          org_id: string
          inventory_id: string
          reason: Database['public']['Enums']['movement_reason']
          quantity_delta: number
          balance_after: number
          reference_type: string | null
          reference_id: string | null
          note: string | null
          idempotency_key: string | null
          actor_type: Database['public']['Enums']['actor_type']
          occurred_at: string
        }
        Insert: {
          id?: number
          org_id: string
          inventory_id: string
          reason: Database['public']['Enums']['movement_reason']
          quantity_delta: number
          balance_after: number
          reference_type?: string | null
          reference_id?: string | null
          note?: string | null
          idempotency_key?: string | null
          actor_type?: Database['public']['Enums']['actor_type']
          occurred_at?: string
        }
        Update: {
          id?: number
          org_id?: string
          inventory_id?: string
          reason?: Database['public']['Enums']['movement_reason']
          quantity_delta?: number
          balance_after?: number
          reference_type?: string | null
          reference_id?: string | null
          note?: string | null
          idempotency_key?: string | null
          actor_type?: Database['public']['Enums']['actor_type']
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_movements_inventory_id_fkey'
            columns: ['inventory_id']
            isOneToOne: false
            referencedRelation: 'inventory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_movements_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      invoices: {
        Row: {
          id: string
          org_id: string
          order_id: string | null
          invoice_number: string
          kind: Database['public']['Enums']['invoice_kind']
          status: Database['public']['Enums']['invoice_status']
          issued_on: string
          supply_date: string | null
          due_on: string | null
          seller_snapshot: Json
          buyer_snapshot: Json
          lines: Json
          net_minor: number
          discount_minor: number
          shipping_minor: number
          vat_minor: number
          gross_minor: number
          currency: string
          vat_rate_pct: number | null
          vat_note: string | null
          pdf_path: string | null
          sent_at: string | null
          sent_to: string | null
          send_attempts: number
          send_error: string | null
          idempotency_key: string
          is_demo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          order_id?: string | null
          invoice_number: string
          kind?: Database['public']['Enums']['invoice_kind']
          status?: Database['public']['Enums']['invoice_status']
          issued_on?: string
          supply_date?: string | null
          due_on?: string | null
          seller_snapshot: Json
          buyer_snapshot: Json
          lines: Json
          net_minor?: number
          discount_minor?: number
          shipping_minor?: number
          vat_minor?: number
          gross_minor?: number
          currency?: string
          vat_rate_pct?: number | null
          vat_note?: string | null
          pdf_path?: string | null
          sent_at?: string | null
          sent_to?: string | null
          send_attempts?: number
          send_error?: string | null
          idempotency_key: string
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          order_id?: string | null
          invoice_number?: string
          kind?: Database['public']['Enums']['invoice_kind']
          status?: Database['public']['Enums']['invoice_status']
          issued_on?: string
          supply_date?: string | null
          due_on?: string | null
          seller_snapshot?: Json
          buyer_snapshot?: Json
          lines?: Json
          net_minor?: number
          discount_minor?: number
          shipping_minor?: number
          vat_minor?: number
          gross_minor?: number
          currency?: string
          vat_rate_pct?: number | null
          vat_note?: string | null
          pdf_path?: string | null
          sent_at?: string | null
          sent_to?: string | null
          send_attempts?: number
          send_error?: string | null
          idempotency_key?: string
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'invoices_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invoices_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      memberships: {
        Row: {
          id: string
          org_id: string
          user_id: string
          role: Database['public']['Enums']['member_role']
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          role?: Database['public']['Enums']['member_role']
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          role?: Database['public']['Enums']['member_role']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'memberships_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'memberships_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          org_id: string
          severity: Database['public']['Enums']['notification_severity']
          category: string
          title: string
          body: string | null
          entity_type: string | null
          entity_id: string | null
          ai_decision_id: string | null
          action_url: string | null
          read_at: string | null
          emailed_at: string | null
          email_error: string | null
          dedupe_key: string | null
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          severity?: Database['public']['Enums']['notification_severity']
          category: string
          title: string
          body?: string | null
          entity_type?: string | null
          entity_id?: string | null
          ai_decision_id?: string | null
          action_url?: string | null
          read_at?: string | null
          emailed_at?: string | null
          email_error?: string | null
          dedupe_key?: string | null
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          severity?: Database['public']['Enums']['notification_severity']
          category?: string
          title?: string
          body?: string | null
          entity_type?: string | null
          entity_id?: string | null
          ai_decision_id?: string | null
          action_url?: string | null
          read_at?: string | null
          emailed_at?: string | null
          email_error?: string | null
          dedupe_key?: string | null
          is_demo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_ai_decision_id_fkey'
            columns: ['ai_decision_id']
            isOneToOne: false
            referencedRelation: 'ai_decisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      opportunity_projections: {
        Row: {
          id: string
          org_id: string
          research_id: string | null
          product_id: string | null
          channel: Database['public']['Enums']['channel_key']
          supplier_id: string | null
          selling_price_minor: number
          landed_cost_minor: number
          net_revenue_minor: number
          contribution_minor: number
          net_profit_minor: number
          break_even_price_minor: number
          currency: string
          gross_margin_pct: number | null
          contribution_margin_pct: number | null
          net_margin_pct: number | null
          gate_passes: boolean
          gate_failures: string[]
          gate_warnings: string[]
          assumptions: Json
          engine_version: string
          computed_at: string
          is_demo: boolean
        }
        Insert: {
          id?: string
          org_id: string
          research_id?: string | null
          product_id?: string | null
          channel: Database['public']['Enums']['channel_key']
          supplier_id?: string | null
          selling_price_minor: number
          landed_cost_minor: number
          net_revenue_minor: number
          contribution_minor: number
          net_profit_minor: number
          break_even_price_minor: number
          currency?: string
          gross_margin_pct?: number | null
          contribution_margin_pct?: number | null
          net_margin_pct?: number | null
          gate_passes: boolean
          gate_failures?: string[]
          gate_warnings?: string[]
          assumptions?: Json
          engine_version: string
          computed_at?: string
          is_demo?: boolean
        }
        Update: {
          id?: string
          org_id?: string
          research_id?: string | null
          product_id?: string | null
          channel?: Database['public']['Enums']['channel_key']
          supplier_id?: string | null
          selling_price_minor?: number
          landed_cost_minor?: number
          net_revenue_minor?: number
          contribution_minor?: number
          net_profit_minor?: number
          break_even_price_minor?: number
          currency?: string
          gross_margin_pct?: number | null
          contribution_margin_pct?: number | null
          net_margin_pct?: number | null
          gate_passes?: boolean
          gate_failures?: string[]
          gate_warnings?: string[]
          assumptions?: Json
          engine_version?: string
          computed_at?: string
          is_demo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'opportunity_projections_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunity_projections_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunity_projections_research_id_fkey'
            columns: ['research_id']
            isOneToOne: false
            referencedRelation: 'product_research'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunity_projections_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          org_id: string
          order_id: string
          product_id: string | null
          variant_id: string | null
          sku: string
          description: string
          quantity: number
          unit_price_minor: number
          discount_minor: number
          tax_rate_pct: number
          tax_minor: number
          line_total_minor: number
          unit_cost_minor: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          order_id: string
          product_id?: string | null
          variant_id?: string | null
          sku: string
          description: string
          quantity: number
          unit_price_minor: number
          discount_minor?: number
          tax_rate_pct?: number
          tax_minor?: number
          line_total_minor: number
          unit_cost_minor?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          order_id?: string
          product_id?: string | null
          variant_id?: string | null
          sku?: string
          description?: string
          quantity?: number
          unit_price_minor?: number
          discount_minor?: number
          tax_rate_pct?: number
          tax_minor?: number
          line_total_minor?: number
          unit_cost_minor?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_items_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_items_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_items_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
        ]
      }
      order_status_transitions: {
        Row: {
          id: number
          org_id: string
          order_id: string
          from_status: Database['public']['Enums']['order_status'] | null
          to_status: Database['public']['Enums']['order_status']
          reason: string
          actor_type: Database['public']['Enums']['actor_type']
          actor_user_id: string | null
          actor_label: string | null
          evidence: Json
          ai_decision_id: string | null
          occurred_at: string
        }
        Insert: {
          id?: number
          org_id: string
          order_id: string
          from_status?: Database['public']['Enums']['order_status'] | null
          to_status: Database['public']['Enums']['order_status']
          reason: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Update: {
          id?: number
          org_id?: string
          order_id?: string
          from_status?: Database['public']['Enums']['order_status'] | null
          to_status?: Database['public']['Enums']['order_status']
          reason?: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'order_status_transitions_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_status_transitions_ai_decision_id_fkey'
            columns: ['ai_decision_id']
            isOneToOne: false
            referencedRelation: 'ai_decisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_status_transitions_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_status_transitions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      orders: {
        Row: {
          id: string
          org_id: string
          order_number: string
          channel: Database['public']['Enums']['channel_key']
          external_id: string | null
          customer_id: string | null
          shipping_address_id: string | null
          billing_address_id: string | null
          status: Database['public']['Enums']['order_status']
          subtotal_minor: number
          shipping_minor: number
          discount_minor: number
          tax_minor: number
          total_minor: number
          currency: string
          cogs_minor: number
          supplier_shipping_minor: number
          channel_fees_minor: number
          payment_fees_minor: number
          refunded_minor: number
          placed_at: string
          fulfilled_at: string | null
          delivered_at: string | null
          idempotency_key: string
          is_demo: boolean
          created_at: string
          updated_at: string
          risk_level: string | null
          risk_assessed_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          order_number: string
          channel: Database['public']['Enums']['channel_key']
          external_id?: string | null
          customer_id?: string | null
          shipping_address_id?: string | null
          billing_address_id?: string | null
          status?: Database['public']['Enums']['order_status']
          subtotal_minor?: number
          shipping_minor?: number
          discount_minor?: number
          tax_minor?: number
          total_minor?: number
          currency?: string
          cogs_minor?: number
          supplier_shipping_minor?: number
          channel_fees_minor?: number
          payment_fees_minor?: number
          refunded_minor?: number
          placed_at?: string
          fulfilled_at?: string | null
          delivered_at?: string | null
          idempotency_key: string
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          risk_level?: string | null
          risk_assessed_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          order_number?: string
          channel?: Database['public']['Enums']['channel_key']
          external_id?: string | null
          customer_id?: string | null
          shipping_address_id?: string | null
          billing_address_id?: string | null
          status?: Database['public']['Enums']['order_status']
          subtotal_minor?: number
          shipping_minor?: number
          discount_minor?: number
          tax_minor?: number
          total_minor?: number
          currency?: string
          cogs_minor?: number
          supplier_shipping_minor?: number
          channel_fees_minor?: number
          payment_fees_minor?: number
          refunded_minor?: number
          placed_at?: string
          fulfilled_at?: string | null
          delivered_at?: string | null
          idempotency_key?: string
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          risk_level?: string | null
          risk_assessed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'orders_billing_address_id_fkey'
            columns: ['billing_address_id']
            isOneToOne: false
            referencedRelation: 'addresses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_shipping_address_id_fkey'
            columns: ['shipping_address_id']
            isOneToOne: false
            referencedRelation: 'addresses'
            referencedColumns: ['id']
          },
        ]
      }
      organisations: {
        Row: {
          id: string
          name: string
          slug: string
          base_currency: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          base_currency?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          base_currency?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          org_id: string
          order_id: string
          provider: string
          external_id: string | null
          status: Database['public']['Enums']['payment_status']
          gross_minor: number
          fee_minor: number
          net_minor: number
          currency: string
          captured_at: string | null
          payout_expected_on: string | null
          payout_received_on: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          order_id: string
          provider: string
          external_id?: string | null
          status?: Database['public']['Enums']['payment_status']
          gross_minor: number
          fee_minor?: number
          net_minor: number
          currency?: string
          captured_at?: string | null
          payout_expected_on?: string | null
          payout_received_on?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          order_id?: string
          provider?: string
          external_id?: string | null
          status?: Database['public']['Enums']['payment_status']
          gross_minor?: number
          fee_minor?: number
          net_minor?: number
          currency?: string
          captured_at?: string | null
          payout_expected_on?: string | null
          payout_received_on?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payments_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      product_content: {
        Row: {
          id: string
          org_id: string
          product_id: string
          channel: string
          title: string | null
          description: string | null
          bullets: string[] | null
          features: string[] | null
          faqs: Json
          seo_title: string | null
          meta_description: string | null
          keywords: string[] | null
          image_brief: string | null
          positioning: string | null
          generated_by: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          channel: string
          title?: string | null
          description?: string | null
          bullets?: string[] | null
          features?: string[] | null
          faqs?: Json
          seo_title?: string | null
          meta_description?: string | null
          keywords?: string[] | null
          image_brief?: string | null
          positioning?: string | null
          generated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          channel?: string
          title?: string | null
          description?: string | null
          bullets?: string[] | null
          features?: string[] | null
          faqs?: Json
          seo_title?: string | null
          meta_description?: string | null
          keywords?: string[] | null
          image_brief?: string | null
          positioning?: string | null
          generated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_content_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_content_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_content_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      product_health: {
        Row: {
          id: string
          org_id: string
          product_id: string
          score: number
          band: string
          components: Json
          weights_version: string
          computed_at: string
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          score: number
          band: string
          components: Json
          weights_version: string
          computed_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          score?: number
          band?: string
          components?: Json
          weights_version?: string
          computed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_health_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_health_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      product_identifiers: {
        Row: {
          id: string
          org_id: string
          product_id: string
          variant_id: string | null
          id_type: Database['public']['Enums']['identifier_type']
          value: string
          source: Database['public']['Enums']['identifier_source']
          evidence: string | null
          verified_at: string | null
          verified_by: string | null
          created_at: string
          validation: Database['public']['Enums']['identifier_validation']
          validation_note: string | null
          validated_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          variant_id?: string | null
          id_type: Database['public']['Enums']['identifier_type']
          value: string
          source: Database['public']['Enums']['identifier_source']
          evidence?: string | null
          verified_at?: string | null
          verified_by?: string | null
          created_at?: string
          validation?: Database['public']['Enums']['identifier_validation']
          validation_note?: string | null
          validated_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          variant_id?: string | null
          id_type?: Database['public']['Enums']['identifier_type']
          value?: string
          source?: Database['public']['Enums']['identifier_source']
          evidence?: string | null
          verified_at?: string | null
          verified_by?: string | null
          created_at?: string
          validation?: Database['public']['Enums']['identifier_validation']
          validation_note?: string | null
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'product_identifiers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_identifiers_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_identifiers_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_identifiers_verified_by_fkey'
            columns: ['verified_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      product_performance: {
        Row: {
          id: string
          org_id: string
          product_id: string
          channel: Database['public']['Enums']['channel_key']
          period_date: string
          impressions: number
          clicks: number
          units_sold: number
          orders: number
          revenue_minor: number
          cogs_minor: number
          fees_minor: number
          ad_spend_minor: number
          refunds_minor: number
          contribution_minor: number
          returns_count: number
          refunds_count: number
          review_count: number
          rating_avg: number | null
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          channel: Database['public']['Enums']['channel_key']
          period_date: string
          impressions?: number
          clicks?: number
          units_sold?: number
          orders?: number
          revenue_minor?: number
          cogs_minor?: number
          fees_minor?: number
          ad_spend_minor?: number
          refunds_minor?: number
          contribution_minor?: number
          returns_count?: number
          refunds_count?: number
          review_count?: number
          rating_avg?: number | null
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          channel?: Database['public']['Enums']['channel_key']
          period_date?: string
          impressions?: number
          clicks?: number
          units_sold?: number
          orders?: number
          revenue_minor?: number
          cogs_minor?: number
          fees_minor?: number
          ad_spend_minor?: number
          refunds_minor?: number
          contribution_minor?: number
          returns_count?: number
          refunds_count?: number
          review_count?: number
          rating_avg?: number | null
          is_demo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_performance_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_performance_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      product_research: {
        Row: {
          id: string
          org_id: string
          product_id: string | null
          candidate_title: string
          category: string | null
          source: Database['public']['Enums']['research_source']
          source_reference: string | null
          collected_at: string
          raw_signals: Json
          complaints: Json
          differentiation: Json
          notes: string | null
          is_demo: boolean
          provider_id: string | null
          run_id: string | null
          status: Database['public']['Enums']['candidate_status']
          rejected_reason: string | null
          estimated_price_minor: number | null
          estimated_unit_cost_minor: number | null
          estimated_shipping_minor: number | null
          estimated_monthly_units: number | null
          currency: string
          review_sample: Json
          review_count: number | null
          rating_avg: number | null
        }
        Insert: {
          id?: string
          org_id: string
          product_id?: string | null
          candidate_title: string
          category?: string | null
          source: Database['public']['Enums']['research_source']
          source_reference?: string | null
          collected_at?: string
          raw_signals?: Json
          complaints?: Json
          differentiation?: Json
          notes?: string | null
          is_demo?: boolean
          provider_id?: string | null
          run_id?: string | null
          status?: Database['public']['Enums']['candidate_status']
          rejected_reason?: string | null
          estimated_price_minor?: number | null
          estimated_unit_cost_minor?: number | null
          estimated_shipping_minor?: number | null
          estimated_monthly_units?: number | null
          currency?: string
          review_sample?: Json
          review_count?: number | null
          rating_avg?: number | null
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string | null
          candidate_title?: string
          category?: string | null
          source?: Database['public']['Enums']['research_source']
          source_reference?: string | null
          collected_at?: string
          raw_signals?: Json
          complaints?: Json
          differentiation?: Json
          notes?: string | null
          is_demo?: boolean
          provider_id?: string | null
          run_id?: string | null
          status?: Database['public']['Enums']['candidate_status']
          rejected_reason?: string | null
          estimated_price_minor?: number | null
          estimated_unit_cost_minor?: number | null
          estimated_shipping_minor?: number | null
          estimated_monthly_units?: number | null
          currency?: string
          review_sample?: Json
          review_count?: number | null
          rating_avg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'product_research_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_research_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_research_provider_id_fkey'
            columns: ['provider_id']
            isOneToOne: false
            referencedRelation: 'research_providers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_research_run_id_fkey'
            columns: ['run_id']
            isOneToOne: false
            referencedRelation: 'research_runs'
            referencedColumns: ['id']
          },
        ]
      }
      product_scores: {
        Row: {
          id: string
          org_id: string
          product_id: string | null
          research_id: string | null
          total_score: number
          band: string
          components: Json
          weights_version: string
          rationale: string | null
          scored_at: string
        }
        Insert: {
          id?: string
          org_id: string
          product_id?: string | null
          research_id?: string | null
          total_score: number
          band: string
          components: Json
          weights_version: string
          rationale?: string | null
          scored_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string | null
          research_id?: string | null
          total_score?: number
          band?: string
          components?: Json
          weights_version?: string
          rationale?: string | null
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_scores_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_scores_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_scores_research_id_fkey'
            columns: ['research_id']
            isOneToOne: false
            referencedRelation: 'product_research'
            referencedColumns: ['id']
          },
        ]
      }
      product_stage_transitions: {
        Row: {
          id: number
          org_id: string
          product_id: string
          from_stage: Database['public']['Enums']['product_stage'] | null
          to_stage: Database['public']['Enums']['product_stage']
          reason: string
          actor_type: Database['public']['Enums']['actor_type']
          actor_user_id: string | null
          actor_label: string | null
          opportunity_score: number | null
          evidence: Json
          ai_decision_id: string | null
          occurred_at: string
        }
        Insert: {
          id?: number
          org_id: string
          product_id: string
          from_stage?: Database['public']['Enums']['product_stage'] | null
          to_stage: Database['public']['Enums']['product_stage']
          reason: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          opportunity_score?: number | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Update: {
          id?: number
          org_id?: string
          product_id?: string
          from_stage?: Database['public']['Enums']['product_stage'] | null
          to_stage?: Database['public']['Enums']['product_stage']
          reason?: string
          actor_type?: Database['public']['Enums']['actor_type']
          actor_user_id?: string | null
          actor_label?: string | null
          opportunity_score?: number | null
          evidence?: Json
          ai_decision_id?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_stage_transitions_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_stage_transitions_ai_decision_id_fkey'
            columns: ['ai_decision_id']
            isOneToOne: false
            referencedRelation: 'ai_decisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_stage_transitions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_stage_transitions_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      product_variants: {
        Row: {
          id: string
          org_id: string
          product_id: string
          sku: string
          title: string
          options: Json
          weight_grams: number | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          sku: string
          title: string
          options?: Json
          weight_grams?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          sku?: string
          title?: string
          options?: Json
          weight_grams?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_variants_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_variants_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      products: {
        Row: {
          id: string
          org_id: string
          sku: string
          title: string
          slug: string | null
          description: string | null
          category: string | null
          brand: string | null
          stage: Database['public']['Enums']['product_stage']
          is_demo: boolean
          weight_grams: number | null
          length_mm: number | null
          width_mm: number | null
          height_mm: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          sku: string
          title: string
          slug?: string | null
          description?: string | null
          category?: string | null
          brand?: string | null
          stage?: Database['public']['Enums']['product_stage']
          is_demo?: boolean
          weight_grams?: number | null
          length_mm?: number | null
          width_mm?: number | null
          height_mm?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          sku?: string
          title?: string
          slug?: string | null
          description?: string | null
          category?: string | null
          brand?: string | null
          stage?: Database['public']['Enums']['product_stage']
          is_demo?: boolean
          weight_grams?: number | null
          length_mm?: number | null
          width_mm?: number | null
          height_mm?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'products_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      refunds: {
        Row: {
          id: string
          org_id: string
          order_id: string
          payment_id: string | null
          amount_minor: number
          tax_minor: number
          currency: string
          reason: Database['public']['Enums']['refund_reason']
          note: string | null
          is_full_refund: boolean
          external_id: string | null
          idempotency_key: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          order_id: string
          payment_id?: string | null
          amount_minor: number
          tax_minor?: number
          currency?: string
          reason?: Database['public']['Enums']['refund_reason']
          note?: string | null
          is_full_refund?: boolean
          external_id?: string | null
          idempotency_key: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          order_id?: string
          payment_id?: string | null
          amount_minor?: number
          tax_minor?: number
          currency?: string
          reason?: Database['public']['Enums']['refund_reason']
          note?: string | null
          is_full_refund?: boolean
          external_id?: string | null
          idempotency_key?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'refunds_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'refunds_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'refunds_payment_id_fkey'
            columns: ['payment_id']
            isOneToOne: false
            referencedRelation: 'payments'
            referencedColumns: ['id']
          },
        ]
      }
      research_providers: {
        Row: {
          id: string
          org_id: string
          provider_key: string
          label: string
          description: string | null
          source_type: Database['public']['Enums']['provider_source_type']
          status: Database['public']['Enums']['provider_status']
          is_enabled: boolean
          required_credentials: string[]
          rate_limit_per_minute: number | null
          rate_limit_per_day: number | null
          min_seconds_between_runs: number
          terms_url: string | null
          permitted_use_note: string | null
          respects_robots: boolean
          last_success_at: string | null
          last_failure_at: string | null
          last_error: string | null
          next_allowed_at: string | null
          consecutive_failures: number
          is_demo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          provider_key: string
          label: string
          description?: string | null
          source_type: Database['public']['Enums']['provider_source_type']
          status?: Database['public']['Enums']['provider_status']
          is_enabled?: boolean
          required_credentials?: string[]
          rate_limit_per_minute?: number | null
          rate_limit_per_day?: number | null
          min_seconds_between_runs?: number
          terms_url?: string | null
          permitted_use_note?: string | null
          respects_robots?: boolean
          last_success_at?: string | null
          last_failure_at?: string | null
          last_error?: string | null
          next_allowed_at?: string | null
          consecutive_failures?: number
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          provider_key?: string
          label?: string
          description?: string | null
          source_type?: Database['public']['Enums']['provider_source_type']
          status?: Database['public']['Enums']['provider_status']
          is_enabled?: boolean
          required_credentials?: string[]
          rate_limit_per_minute?: number | null
          rate_limit_per_day?: number | null
          min_seconds_between_runs?: number
          terms_url?: string | null
          permitted_use_note?: string | null
          respects_robots?: boolean
          last_success_at?: string | null
          last_failure_at?: string | null
          last_error?: string | null
          next_allowed_at?: string | null
          consecutive_failures?: number
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'research_providers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      research_runs: {
        Row: {
          id: string
          org_id: string
          provider_id: string
          status: string
          started_at: string
          finished_at: string | null
          duration_ms: number | null
          candidates_found: number
          candidates_accepted: number
          candidates_rejected: number
          requests_made: number
          error: string | null
          summary: Json
          idempotency_key: string | null
        }
        Insert: {
          id?: string
          org_id: string
          provider_id: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          candidates_found?: number
          candidates_accepted?: number
          candidates_rejected?: number
          requests_made?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          provider_id?: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          candidates_found?: number
          candidates_accepted?: number
          candidates_rejected?: number
          requests_made?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'research_runs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'research_runs_provider_id_fkey'
            columns: ['provider_id']
            isOneToOne: false
            referencedRelation: 'research_providers'
            referencedColumns: ['id']
          },
        ]
      }
      shipments: {
        Row: {
          id: string
          org_id: string
          fulfilment_id: string
          carrier: string | null
          service: string | null
          tracking_number: string | null
          tracking_url: string | null
          shipped_at: string | null
          delivered_at: string | null
          promised_by: string | null
          last_status: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          fulfilment_id: string
          carrier?: string | null
          service?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          shipped_at?: string | null
          delivered_at?: string | null
          promised_by?: string | null
          last_status?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          fulfilment_id?: string
          carrier?: string | null
          service?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          shipped_at?: string | null
          delivered_at?: string | null
          promised_by?: string | null
          last_status?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'shipments_fulfilment_id_fkey'
            columns: ['fulfilment_id']
            isOneToOne: false
            referencedRelation: 'fulfilments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shipments_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      shopify_listings: {
        Row: {
          channel_product_id: string
          org_id: string
          shopify_product_id: string | null
          shopify_variant_id: string | null
          handle: string | null
          published: boolean
          updated_at: string
        }
        Insert: {
          channel_product_id: string
          org_id: string
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          handle?: string | null
          published?: boolean
          updated_at?: string
        }
        Update: {
          channel_product_id?: string
          org_id?: string
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          handle?: string | null
          published?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'shopify_listings_channel_product_id_fkey'
            columns: ['channel_product_id']
            isOneToOne: true
            referencedRelation: 'channel_products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shopify_listings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_connector_runs: {
        Row: {
          id: string
          org_id: string
          connector_id: string
          status: string
          started_at: string
          finished_at: string | null
          duration_ms: number | null
          products_checked: number
          products_updated: number
          stock_changes_detected: number
          price_changes_detected: number
          requests_made: number
          error: string | null
          summary: Json
          idempotency_key: string | null
        }
        Insert: {
          id?: string
          org_id: string
          connector_id: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          products_checked?: number
          products_updated?: number
          stock_changes_detected?: number
          price_changes_detected?: number
          requests_made?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          connector_id?: string
          status?: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          products_checked?: number
          products_updated?: number
          stock_changes_detected?: number
          price_changes_detected?: number
          requests_made?: number
          error?: string | null
          summary?: Json
          idempotency_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_connector_runs_connector_id_fkey'
            columns: ['connector_id']
            isOneToOne: false
            referencedRelation: 'supplier_connectors'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_connector_runs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_connectors: {
        Row: {
          id: string
          org_id: string
          supplier_id: string
          connector_key: string
          label: string
          source_type: Database['public']['Enums']['connector_source_type']
          status: Database['public']['Enums']['connector_status']
          is_enabled: boolean
          required_credentials: string[]
          rate_limit_per_minute: number | null
          rate_limit_per_day: number | null
          min_seconds_between_runs: number
          config: Json
          last_success_at: string | null
          last_failure_at: string | null
          last_error: string | null
          next_allowed_at: string | null
          consecutive_failures: number
          is_demo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          supplier_id: string
          connector_key: string
          label: string
          source_type: Database['public']['Enums']['connector_source_type']
          status?: Database['public']['Enums']['connector_status']
          is_enabled?: boolean
          required_credentials?: string[]
          rate_limit_per_minute?: number | null
          rate_limit_per_day?: number | null
          min_seconds_between_runs?: number
          config?: Json
          last_success_at?: string | null
          last_failure_at?: string | null
          last_error?: string | null
          next_allowed_at?: string | null
          consecutive_failures?: number
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          supplier_id?: string
          connector_key?: string
          label?: string
          source_type?: Database['public']['Enums']['connector_source_type']
          status?: Database['public']['Enums']['connector_status']
          is_enabled?: boolean
          required_credentials?: string[]
          rate_limit_per_minute?: number | null
          rate_limit_per_day?: number | null
          min_seconds_between_runs?: number
          config?: Json
          last_success_at?: string | null
          last_failure_at?: string | null
          last_error?: string | null
          next_allowed_at?: string | null
          consecutive_failures?: number
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_connectors_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_connectors_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_documents: {
        Row: {
          id: string
          org_id: string
          supplier_id: string
          product_id: string | null
          doc_type: Database['public']['Enums']['supplier_document_type']
          title: string
          storage_path: string | null
          issued_on: string | null
          expires_on: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          supplier_id: string
          product_id?: string | null
          doc_type: Database['public']['Enums']['supplier_document_type']
          title: string
          storage_path?: string | null
          issued_on?: string | null
          expires_on?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          supplier_id?: string
          product_id?: string | null
          doc_type?: Database['public']['Enums']['supplier_document_type']
          title?: string
          storage_path?: string | null
          issued_on?: string | null
          expires_on?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_documents_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_documents_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_documents_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_invoices: {
        Row: {
          id: string
          org_id: string
          supplier_id: string
          supplier_order_id: string | null
          invoice_number: string | null
          issued_on: string | null
          due_on: string | null
          net_minor: number
          vat_minor: number
          gross_minor: number
          currency: string
          paid_on: string | null
          document_path: string | null
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          supplier_id: string
          supplier_order_id?: string | null
          invoice_number?: string | null
          issued_on?: string | null
          due_on?: string | null
          net_minor?: number
          vat_minor?: number
          gross_minor?: number
          currency?: string
          paid_on?: string | null
          document_path?: string | null
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          supplier_id?: string
          supplier_order_id?: string | null
          invoice_number?: string | null
          issued_on?: string | null
          due_on?: string | null
          net_minor?: number
          vat_minor?: number
          gross_minor?: number
          currency?: string
          paid_on?: string | null
          document_path?: string | null
          is_demo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_invoices_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_invoices_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_invoices_supplier_order_id_fkey'
            columns: ['supplier_order_id']
            isOneToOne: false
            referencedRelation: 'supplier_orders'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_order_items: {
        Row: {
          id: string
          org_id: string
          supplier_order_id: string
          product_id: string | null
          variant_id: string | null
          description: string
          quantity: number
          unit_cost_minor: number
          line_total_minor: number
        }
        Insert: {
          id?: string
          org_id: string
          supplier_order_id: string
          product_id?: string | null
          variant_id?: string | null
          description: string
          quantity: number
          unit_cost_minor: number
          line_total_minor: number
        }
        Update: {
          id?: string
          org_id?: string
          supplier_order_id?: string
          product_id?: string | null
          variant_id?: string | null
          description?: string
          quantity?: number
          unit_cost_minor?: number
          line_total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_order_items_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_order_items_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_order_items_supplier_order_id_fkey'
            columns: ['supplier_order_id']
            isOneToOne: false
            referencedRelation: 'supplier_orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_order_items_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_orders: {
        Row: {
          id: string
          org_id: string
          supplier_id: string
          reference: string
          status: Database['public']['Enums']['supplier_order_status']
          subtotal_minor: number
          shipping_minor: number
          tax_minor: number
          total_minor: number
          currency: string
          requires_approval: boolean
          approved_by: string | null
          approved_at: string | null
          idempotency_key: string
          expected_at: string | null
          placed_at: string | null
          received_at: string | null
          is_demo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          supplier_id: string
          reference: string
          status?: Database['public']['Enums']['supplier_order_status']
          subtotal_minor?: number
          shipping_minor?: number
          tax_minor?: number
          total_minor?: number
          currency?: string
          requires_approval?: boolean
          approved_by?: string | null
          approved_at?: string | null
          idempotency_key: string
          expected_at?: string | null
          placed_at?: string | null
          received_at?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          supplier_id?: string
          reference?: string
          status?: Database['public']['Enums']['supplier_order_status']
          subtotal_minor?: number
          shipping_minor?: number
          tax_minor?: number
          total_minor?: number
          currency?: string
          requires_approval?: boolean
          approved_by?: string | null
          approved_at?: string | null
          idempotency_key?: string
          expected_at?: string | null
          placed_at?: string | null
          received_at?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_orders_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_orders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_orders_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_price_history: {
        Row: {
          id: number
          org_id: string
          supplier_product_id: string
          previous_unit_cost_minor: number | null
          new_unit_cost_minor: number
          currency: string
          change_pct: number | null
          source: Database['public']['Enums']['price_change_source']
          connector_run_id: string | null
          detected_at: string
        }
        Insert: {
          id?: number
          org_id: string
          supplier_product_id: string
          previous_unit_cost_minor?: number | null
          new_unit_cost_minor: number
          currency?: string
          change_pct?: number | null
          source?: Database['public']['Enums']['price_change_source']
          connector_run_id?: string | null
          detected_at?: string
        }
        Update: {
          id?: number
          org_id?: string
          supplier_product_id?: string
          previous_unit_cost_minor?: number | null
          new_unit_cost_minor?: number
          currency?: string
          change_pct?: number | null
          source?: Database['public']['Enums']['price_change_source']
          connector_run_id?: string | null
          detected_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_price_history_connector_run_id_fkey'
            columns: ['connector_run_id']
            isOneToOne: false
            referencedRelation: 'supplier_connector_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_price_history_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_price_history_supplier_product_id_fkey'
            columns: ['supplier_product_id']
            isOneToOne: false
            referencedRelation: 'supplier_products'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_products: {
        Row: {
          id: string
          org_id: string
          supplier_id: string
          product_id: string
          variant_id: string | null
          supplier_sku: string | null
          unit_cost_minor: number
          shipping_cost_minor: number
          currency: string
          moq: number
          lead_time_days: number | null
          stock_qty: number | null
          in_stock: boolean
          is_preferred: boolean
          last_verified_at: string | null
          is_demo: boolean
          created_at: string
          updated_at: string
          stock_checked_at: string | null
          dispatch_days_min: number | null
          dispatch_days_max: number | null
          cancellation_rate_pct: number | null
          fulfilment_success_rate_pct: number | null
          last_connector_run_id: string | null
        }
        Insert: {
          id?: string
          org_id: string
          supplier_id: string
          product_id: string
          variant_id?: string | null
          supplier_sku?: string | null
          unit_cost_minor: number
          shipping_cost_minor?: number
          currency?: string
          moq?: number
          lead_time_days?: number | null
          stock_qty?: number | null
          in_stock?: boolean
          is_preferred?: boolean
          last_verified_at?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          stock_checked_at?: string | null
          dispatch_days_min?: number | null
          dispatch_days_max?: number | null
          cancellation_rate_pct?: number | null
          fulfilment_success_rate_pct?: number | null
          last_connector_run_id?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          supplier_id?: string
          product_id?: string
          variant_id?: string | null
          supplier_sku?: string | null
          unit_cost_minor?: number
          shipping_cost_minor?: number
          currency?: string
          moq?: number
          lead_time_days?: number | null
          stock_qty?: number | null
          in_stock?: boolean
          is_preferred?: boolean
          last_verified_at?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          stock_checked_at?: string | null
          dispatch_days_min?: number | null
          dispatch_days_max?: number | null
          cancellation_rate_pct?: number | null
          fulfilment_success_rate_pct?: number | null
          last_connector_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_products_last_connector_run_id_fkey'
            columns: ['last_connector_run_id']
            isOneToOne: false
            referencedRelation: 'supplier_connector_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_products_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_products_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_products_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_products_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_scores: {
        Row: {
          id: string
          org_id: string
          supplier_id: string
          total_score: number
          components: Json
          weights_version: string
          rationale: string | null
          scored_at: string
        }
        Insert: {
          id?: string
          org_id: string
          supplier_id: string
          total_score: number
          components: Json
          weights_version: string
          rationale?: string | null
          scored_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          supplier_id?: string
          total_score?: number
          components?: Json
          weights_version?: string
          rationale?: string | null
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_scores_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_scores_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      suppliers: {
        Row: {
          id: string
          org_id: string
          name: string
          company_name: string | null
          website: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          platform: string | null
          supports_blind_shipping: boolean
          supports_custom_packaging: boolean
          supports_custom_invoice: boolean
          provides_tracking: boolean
          handles_returns: boolean
          ships_from_country: string | null
          typical_delivery_days_min: number | null
          typical_delivery_days_max: number | null
          shopify_status: Database['public']['Enums']['approval_status']
          amazon_status: Database['public']['Enums']['approval_status']
          status_reason: string | null
          last_assessed_at: string | null
          is_demo: boolean
          created_at: string
          updated_at: string
          returns_policy: string | null
          returns_window_days: number | null
          accepts_faulty_returns: boolean
          min_order_value_minor: number | null
          supports_own_branding: boolean
          notes: string | null
          orders_placed: number
          orders_late: number
          orders_defective: number
          quality_rating: number | null
          communication_rating: number | null
          current_score: number | null
          current_score_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          company_name?: string | null
          website?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          platform?: string | null
          supports_blind_shipping?: boolean
          supports_custom_packaging?: boolean
          supports_custom_invoice?: boolean
          provides_tracking?: boolean
          handles_returns?: boolean
          ships_from_country?: string | null
          typical_delivery_days_min?: number | null
          typical_delivery_days_max?: number | null
          shopify_status?: Database['public']['Enums']['approval_status']
          amazon_status?: Database['public']['Enums']['approval_status']
          status_reason?: string | null
          last_assessed_at?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          returns_policy?: string | null
          returns_window_days?: number | null
          accepts_faulty_returns?: boolean
          min_order_value_minor?: number | null
          supports_own_branding?: boolean
          notes?: string | null
          orders_placed?: number
          orders_late?: number
          orders_defective?: number
          quality_rating?: number | null
          communication_rating?: number | null
          current_score?: number | null
          current_score_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          company_name?: string | null
          website?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          platform?: string | null
          supports_blind_shipping?: boolean
          supports_custom_packaging?: boolean
          supports_custom_invoice?: boolean
          provides_tracking?: boolean
          handles_returns?: boolean
          ships_from_country?: string | null
          typical_delivery_days_min?: number | null
          typical_delivery_days_max?: number | null
          shopify_status?: Database['public']['Enums']['approval_status']
          amazon_status?: Database['public']['Enums']['approval_status']
          status_reason?: string | null
          last_assessed_at?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          returns_policy?: string | null
          returns_window_days?: number | null
          accepts_faulty_returns?: boolean
          min_order_value_minor?: number | null
          supports_own_branding?: boolean
          notes?: string | null
          orders_placed?: number
          orders_late?: number
          orders_defective?: number
          quality_rating?: number | null
          communication_rating?: number | null
          current_score?: number | null
          current_score_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'suppliers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
      tax_transactions: {
        Row: {
          id: string
          org_id: string
          direction: string
          order_id: string | null
          invoice_id: string | null
          credit_note_id: string | null
          expense_id: string | null
          treatment: Database['public']['Enums']['vat_treatment']
          rate_pct: number
          net_minor: number
          vat_minor: number
          currency: string
          customer_country: string | null
          supplier_country: string | null
          ship_from_country: string | null
          ship_to_country: string | null
          channel: Database['public']['Enums']['channel_key'] | null
          jurisdiction: string
          needs_review: boolean
          review_reason: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          occurred_on: string
          is_demo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          direction: string
          order_id?: string | null
          invoice_id?: string | null
          credit_note_id?: string | null
          expense_id?: string | null
          treatment: Database['public']['Enums']['vat_treatment']
          rate_pct?: number
          net_minor: number
          vat_minor: number
          currency?: string
          customer_country?: string | null
          supplier_country?: string | null
          ship_from_country?: string | null
          ship_to_country?: string | null
          channel?: Database['public']['Enums']['channel_key'] | null
          jurisdiction?: string
          needs_review?: boolean
          review_reason?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          occurred_on?: string
          is_demo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          direction?: string
          order_id?: string | null
          invoice_id?: string | null
          credit_note_id?: string | null
          expense_id?: string | null
          treatment?: Database['public']['Enums']['vat_treatment']
          rate_pct?: number
          net_minor?: number
          vat_minor?: number
          currency?: string
          customer_country?: string | null
          supplier_country?: string | null
          ship_from_country?: string | null
          ship_to_country?: string | null
          channel?: Database['public']['Enums']['channel_key'] | null
          jurisdiction?: string
          needs_review?: boolean
          review_reason?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          occurred_on?: string
          is_demo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tax_transactions_credit_note_id_fkey'
            columns: ['credit_note_id']
            isOneToOne: false
            referencedRelation: 'credit_notes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tax_transactions_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tax_transactions_invoice_id_fkey'
            columns: ['invoice_id']
            isOneToOne: false
            referencedRelation: 'invoices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tax_transactions_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tax_transactions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tax_transactions_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      vat_periods: {
        Row: {
          id: string
          org_id: string
          starts_on: string
          ends_on: string
          due_on: string | null
          status: string
          output_vat_minor: number
          input_vat_minor: number
          net_due_minor: number
          filed_at: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          starts_on: string
          ends_on: string
          due_on?: string | null
          status?: string
          output_vat_minor?: number
          input_vat_minor?: number
          net_due_minor?: number
          filed_at?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          starts_on?: string
          ends_on?: string
          due_on?: string | null
          status?: string
          output_vat_minor?: number
          input_vat_minor?: number
          net_due_minor?: number
          filed_at?: string | null
          note?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vat_periods_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organisations'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      actor_type: 'user' | 'system' | 'ai' | 'integration'
      approval_status: 'approved' | 'blocked' | 'review_required' | 'not_assessed'
      automation_action_status: 'pending' | 'executing' | 'succeeded' | 'failed' | 'blocked' | 'requires_approval' | 'retry_pending' | 'stale_facts' | 'cancelled'
      automation_action_type: 'update_inventory' | 'update_price' | 'pause_product' | 'resume_product' | 'publish_product' | 'unpublish_product' | 'switch_supplier' | 'submit_supplier_order' | 'update_fulfilment' | 'update_tracking' | 'process_refund' | 'cancel_order' | 'request_approval' | 'reconcile_marketplace' | 'reconcile_supplier' | 'alert_owner'
      automation_job_status: 'pending' | 'running' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled'
      automation_level: 'manual' | 'assisted' | 'supervised' | 'autonomous'
      automation_risk_level: 'low' | 'medium' | 'high' | 'unknown'
      candidate_status: 'new' | 'scored' | 'promoted' | 'rejected' | 'duplicate' | 'archived'
      channel_key: 'shopify' | 'amazon_uk'
      channel_listing_status: 'not_listed' | 'draft' | 'review_required' | 'blocked' | 'testing' | 'live' | 'paused' | 'removed'
      compliance_verdict: 'pass' | 'fail' | 'review_required' | 'not_assessed'
      connector_source_type: 'api' | 'feed' | 'csv' | 'manual' | 'custom'
      connector_status: 'not_configured' | 'disabled' | 'ready' | 'healthy' | 'degraded' | 'failing' | 'rate_limited'
      decision_status: 'recommended' | 'awaiting_approval' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired' | 'superseded'
      differentiation_kind: 'bundle' | 'packaging' | 'instructions' | 'accessories' | 'positioning' | 'quality' | 'support' | 'warranty' | 'variation' | 'value'
      discrepancy_field: 'stock' | 'price' | 'listing_status' | 'order_status' | 'fulfilment_status' | 'tracking'
      expense_category: 'supplier_goods' | 'supplier_shipping' | 'marketplace_fee' | 'payment_fee' | 'advertising' | 'software' | 'packaging' | 'shipping' | 'professional_fees' | 'refund' | 'other'
      fulfilment_status: 'pending' | 'awaiting_supplier' | 'submitted' | 'accepted' | 'shipped' | 'delivered' | 'failed' | 'cancelled'
      identifier_source: 'manufacturer' | 'supplier' | 'gs1' | 'marketplace' | 'owner_supplied' | 'gtin_exemption'
      identifier_type: 'sku' | 'upc' | 'ean' | 'gtin' | 'isbn' | 'asin' | 'mpn' | 'supplier_sku'
      identifier_validation: 'valid' | 'invalid_format' | 'invalid_check_digit' | 'unverified' | 'exempt'
      invoice_kind: 'commercial_invoice' | 'vat_invoice' | 'receipt'
      invoice_status: 'draft' | 'issued' | 'sent' | 'paid' | 'void' | 'failed'
      marketplace_connection_status: 'demo' | 'not_configured' | 'connected' | 'degraded' | 'error'
      marketplace_listing_state: 'discovered' | 'evaluating' | 'approved' | 'ready_to_list' | 'pending_approval' | 'published' | 'paused' | 'ended' | 'blocked'
      member_role: 'owner' | 'admin' | 'analyst' | 'viewer'
      movement_reason: 'purchase_received' | 'sale' | 'reservation' | 'reservation_released' | 'return' | 'adjustment' | 'damage' | 'loss' | 'recount' | 'supplier_sync' | 'demo_seed'
      notification_severity: 'info' | 'success' | 'warning' | 'critical' | 'approval_required'
      order_status: 'pending' | 'paid' | 'awaiting_fulfilment' | 'partially_fulfilled' | 'fulfilled' | 'delivered' | 'cancelled' | 'refunded' | 'partially_refunded' | 'failed'
      payment_status: 'pending' | 'authorised' | 'captured' | 'failed' | 'refunded' | 'partially_refunded'
      price_change_source: 'connector_sync' | 'manual' | 'demo'
      product_stage: 'discovered' | 'researching' | 'supplier_review' | 'compliance_review' | 'approved' | 'testing' | 'proven' | 'scaling' | 'mature' | 'declining' | 'rejected' | 'paused' | 'removed'
      provider_source_type: 'official_api' | 'licensed_dataset' | 'permitted_public' | 'supplier_feed' | 'manual_entry' | 'simulated'
      provider_status: 'not_configured' | 'disabled' | 'ready' | 'healthy' | 'degraded' | 'failing' | 'rate_limited'
      refund_reason: 'customer_changed_mind' | 'damaged' | 'not_as_described' | 'not_delivered' | 'late_delivery' | 'faulty' | 'goodwill' | 'pricing_error' | 'other'
      research_source: 'google_trends' | 'amazon_api' | 'shopify_api' | 'tiktok_api' | 'supplier_catalogue' | 'licensed_dataset' | 'manual' | 'demo'
      supplier_document_type: 'invoice' | 'contract' | 'certificate_of_conformity' | 'safety_datasheet' | 'test_report' | 'insurance' | 'authorisation_letter' | 'other'
      supplier_order_status: 'draft' | 'awaiting_approval' | 'approved' | 'placed' | 'confirmed' | 'shipped' | 'received' | 'cancelled' | 'failed'
      vat_treatment: 'standard' | 'reduced' | 'zero_rated' | 'exempt' | 'outside_scope' | 'reverse_charge' | 'marketplace_deemed_supplier' | 'not_registered' | 'review_required'
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
