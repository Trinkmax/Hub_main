export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      acc_access: {
        Row: {
          display_name: string
          granted_at: string
          granted_by: string | null
          granted_by_name: string | null
          id: string
          is_admin: boolean
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope: string
          source: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          display_name: string
          granted_at?: string
          granted_by?: string | null
          granted_by_name?: string | null
          id?: string
          is_admin?: boolean
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: string
          source?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          display_name?: string
          granted_at?: string
          granted_by?: string | null
          granted_by_name?: string | null
          id?: string
          is_admin?: boolean
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: string
          source?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_access_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_accounts: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_treasury: boolean
          level: number
          manual_selectable: boolean
          name: string
          normal_side: Database["public"]["Enums"]["acc_side"]
          parent_id: string | null
          path: string[]
          postable: boolean
          purchase_selectable: boolean
          requires_party: boolean
          sort: number
          system_key: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["acc_account_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_treasury?: boolean
          level?: number
          manual_selectable?: boolean
          name: string
          normal_side: Database["public"]["Enums"]["acc_side"]
          parent_id?: string | null
          path?: string[]
          postable?: boolean
          purchase_selectable?: boolean
          requires_party?: boolean
          sort?: number
          system_key?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["acc_account_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_treasury?: boolean
          level?: number
          manual_selectable?: boolean
          name?: string
          normal_side?: Database["public"]["Enums"]["acc_side"]
          parent_id?: string | null
          path?: string[]
          postable?: boolean
          purchase_selectable?: boolean
          requires_party?: boolean
          sort?: number
          system_key?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["acc_account_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aac_parent_same_tenant"
            columns: ["parent_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_allocations: {
        Row: {
          account_id: string
          amount_cents: number
          applied_on: string
          created_at: string
          created_by: string
          created_by_name: string
          credit_line_id: string
          debit_line_id: string
          document_id: string | null
          id: string
          kind: string
          party_id: string
          tenant_id: string
          updated_at: string
          void_document_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_on: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          applied_on: string
          created_at?: string
          created_by: string
          created_by_name: string
          credit_line_id: string
          debit_line_id: string
          document_id?: string | null
          id?: string
          kind: string
          party_id: string
          tenant_id: string
          updated_at?: string
          void_document_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_on?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          applied_on?: string
          created_at?: string
          created_by?: string
          created_by_name?: string
          credit_line_id?: string
          debit_line_id?: string
          document_id?: string | null
          id?: string
          kind?: string
          party_id?: string
          tenant_id?: string
          updated_at?: string
          void_document_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aal_account_same_tenant"
            columns: ["account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aal_credit_same_tenant"
            columns: ["credit_line_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_journal_lines"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aal_debit_same_tenant"
            columns: ["debit_line_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_journal_lines"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aal_doc_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aal_party_same_tenant"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aal_void_doc_same_tenant"
            columns: ["void_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_arca_connections: {
        Row: {
          alias: string
          allowed_classes: string[]
          cert_cuit: string
          cert_issuer: string | null
          cert_not_after: string | null
          cert_not_before: string | null
          cert_serial: string | null
          certificate_pem: string | null
          created_at: string
          created_by: string | null
          csr_pem: string | null
          default_concepto: number
          emission_enabled: boolean
          environment: string
          id: string
          last_error_key: string | null
          last_test: Json | null
          last_test_at: string | null
          pending_csr_pem: string | null
          pending_public_key_sha256: string | null
          point_of_sale: number | null
          public_key_sha256: string | null
          represented_cuit: string
          services: Json
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alias: string
          allowed_classes?: string[]
          cert_cuit: string
          cert_issuer?: string | null
          cert_not_after?: string | null
          cert_not_before?: string | null
          cert_serial?: string | null
          certificate_pem?: string | null
          created_at?: string
          created_by?: string | null
          csr_pem?: string | null
          default_concepto?: number
          emission_enabled?: boolean
          environment: string
          id?: string
          last_error_key?: string | null
          last_test?: Json | null
          last_test_at?: string | null
          pending_csr_pem?: string | null
          pending_public_key_sha256?: string | null
          point_of_sale?: number | null
          public_key_sha256?: string | null
          represented_cuit: string
          services?: Json
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alias?: string
          allowed_classes?: string[]
          cert_cuit?: string
          cert_issuer?: string | null
          cert_not_after?: string | null
          cert_not_before?: string | null
          cert_serial?: string | null
          certificate_pem?: string | null
          created_at?: string
          created_by?: string | null
          csr_pem?: string | null
          default_concepto?: number
          emission_enabled?: boolean
          environment?: string
          id?: string
          last_error_key?: string | null
          last_test?: Json | null
          last_test_at?: string | null
          pending_csr_pem?: string | null
          pending_public_key_sha256?: string | null
          point_of_sale?: number | null
          public_key_sha256?: string | null
          represented_cuit?: string
          services?: Json
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_arca_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_arca_padron_cache: {
        Row: {
          cuit: string
          data: Json
          environment: string
          fetched_at: string
          found: boolean
          tenant_id: string
        }
        Insert: {
          cuit: string
          data: Json
          environment: string
          fetched_at?: string
          found: boolean
          tenant_id: string
        }
        Update: {
          cuit?: string
          data?: Json
          environment?: string
          fetched_at?: string
          found?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_arca_padron_cache_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_arca_tickets: {
        Row: {
          connection_id: string
          cooldown_manual: boolean
          cooldown_until: string | null
          expiration_time: string | null
          generation_time: string | null
          last_error_at: string | null
          last_error_key: string | null
          lease_id: string | null
          lease_until: string | null
          service: string
          sign_enc: string | null
          tenant_id: string
          token_enc: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          cooldown_manual?: boolean
          cooldown_until?: string | null
          expiration_time?: string | null
          generation_time?: string | null
          last_error_at?: string | null
          last_error_key?: string | null
          lease_id?: string | null
          lease_until?: string | null
          service: string
          sign_enc?: string | null
          tenant_id: string
          token_enc?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          cooldown_manual?: boolean
          cooldown_until?: string | null
          expiration_time?: string | null
          generation_time?: string | null
          last_error_at?: string | null
          last_error_key?: string | null
          lease_id?: string | null
          lease_until?: string | null
          service?: string
          sign_enc?: string | null
          tenant_id?: string
          token_enc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_arca_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atkt_conn_fk"
            columns: ["connection_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_arca_connections"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_arca_vouchers: {
        Row: {
          cae: string | null
          cae_due: string | null
          cbte_tipo: number
          client_ref: string
          connection_id: string
          created_at: string
          created_by: string
          created_by_name: string
          document_id: string | null
          environment: string
          errors: Json
          events: Json
          fch_proceso: string | null
          form: Json
          id: string
          issue_date: string | null
          number: number | null
          observations: Json
          point_of_sale: number
          reason: string | null
          related_voucher_id: string | null
          request: Json | null
          request_sha256: string | null
          result: string | null
          status: string
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          cae?: string | null
          cae_due?: string | null
          cbte_tipo: number
          client_ref?: string
          connection_id: string
          created_at?: string
          created_by: string
          created_by_name: string
          document_id?: string | null
          environment: string
          errors?: Json
          events?: Json
          fch_proceso?: string | null
          form: Json
          id?: string
          issue_date?: string | null
          number?: number | null
          observations?: Json
          point_of_sale: number
          reason?: string | null
          related_voucher_id?: string | null
          request?: Json | null
          request_sha256?: string | null
          result?: string | null
          status?: string
          tenant_id: string
          total_cents: number
          updated_at?: string
        }
        Update: {
          cae?: string | null
          cae_due?: string | null
          cbte_tipo?: number
          client_ref?: string
          connection_id?: string
          created_at?: string
          created_by?: string
          created_by_name?: string
          document_id?: string | null
          environment?: string
          errors?: Json
          events?: Json
          fch_proceso?: string | null
          form?: Json
          id?: string
          issue_date?: string | null
          number?: number | null
          observations?: Json
          point_of_sale?: number
          reason?: string | null
          related_voucher_id?: string | null
          request?: Json | null
          request_sha256?: string | null
          result?: string | null
          status?: string
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aavo_conn_fk"
            columns: ["connection_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_arca_connections"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aavo_doc_fk"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aavo_related_fk"
            columns: ["related_voucher_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_arca_vouchers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_arca_vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_bundles: {
        Row: {
          client_ref: string
          created_at: string
          created_by: string
          created_by_name: string
          id: string
          operation: string
          preview_hash: string | null
          request_hash: string
          result: Json
          tenant_id: string
        }
        Insert: {
          client_ref: string
          created_at?: string
          created_by: string
          created_by_name: string
          id?: string
          operation: string
          preview_hash?: string | null
          request_hash: string
          result?: Json
          tenant_id: string
        }
        Update: {
          client_ref?: string
          created_at?: string
          created_by?: string
          created_by_name?: string
          id?: string
          operation?: string
          preview_hash?: string | null
          request_hash?: string
          result?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_bundles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_card_installments: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string
          installments: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id: string
          installments: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string
          installments?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_card_installments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aci_document_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_daily_cash_counts: {
        Row: {
          amount_cents: number
          day: string
          tenant_id: string
          treasury_account_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_cents: number
          day: string
          tenant_id: string
          treasury_account_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_cents?: number
          day?: string
          tenant_id?: string
          treasury_account_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_daily_cash_counts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adcc_treasury_same_tenant"
            columns: ["treasury_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_treasury_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_document_attachments: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_document_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adat_doc_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_document_lines: {
        Row: {
          account_id: string
          amount_cents: number
          base_cents: number | null
          certificate_number: string | null
          channel: string | null
          document_id: string
          due_date: string | null
          id: string
          jurisdiction_code: number | null
          line_no: number
          memo: string | null
          party_id: string | null
          reference: string | null
          role: string
          sales_method_id: string | null
          side: Database["public"]["Enums"]["acc_side"]
          tax_kind: string | null
          tenant_id: string
          treasury_account_id: string | null
          vat_computed_cents: number | null
          vat_rate_bp: number | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          base_cents?: number | null
          certificate_number?: string | null
          channel?: string | null
          document_id: string
          due_date?: string | null
          id?: string
          jurisdiction_code?: number | null
          line_no: number
          memo?: string | null
          party_id?: string | null
          reference?: string | null
          role: string
          sales_method_id?: string | null
          side: Database["public"]["Enums"]["acc_side"]
          tax_kind?: string | null
          tenant_id: string
          treasury_account_id?: string | null
          vat_computed_cents?: number | null
          vat_rate_bp?: number | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          base_cents?: number | null
          certificate_number?: string | null
          channel?: string | null
          document_id?: string
          due_date?: string | null
          id?: string
          jurisdiction_code?: number | null
          line_no?: number
          memo?: string | null
          party_id?: string | null
          reference?: string | null
          role?: string
          sales_method_id?: string | null
          side?: Database["public"]["Enums"]["acc_side"]
          tax_kind?: string | null
          tenant_id?: string
          treasury_account_id?: string | null
          vat_computed_cents?: number | null
          vat_rate_bp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_document_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adl_account_same_tenant"
            columns: ["account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adl_doc_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adl_method_same_tenant"
            columns: ["sales_method_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_sales_methods"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adl_party_same_tenant"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adl_treasury_same_tenant"
            columns: ["treasury_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_treasury_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_documents: {
        Row: {
          accounting_date: string
          afip_voucher_code: number | null
          branch_id: string | null
          bundle_id: string
          control_account_id: string | null
          corrects_document_id: string | null
          counted_cents: number | null
          created_at: string
          created_by: string
          created_by_name: string
          description: string
          due_date: string | null
          expected_book_cents: number | null
          id: string
          issue_date: string
          kind: string
          notes: string | null
          number: number | null
          override_reason: string | null
          party_doc_number_snapshot: string | null
          party_doc_type_snapshot: number | null
          party_id: string | null
          party_iva_condition_snapshot: string | null
          party_name_snapshot: string | null
          period_id: string
          point_of_sale: number | null
          recurring_expense_id: string | null
          related_document_id: string | null
          replaces_document_id: string | null
          reverses_document_id: string | null
          seq: number
          settles_commissions: boolean
          shift: string | null
          status: string
          tenant_id: string
          total_cents: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_name: string | null
          voucher_type: string | null
          warnings_ack: string[]
        }
        Insert: {
          accounting_date: string
          afip_voucher_code?: number | null
          branch_id?: string | null
          bundle_id: string
          control_account_id?: string | null
          corrects_document_id?: string | null
          counted_cents?: number | null
          created_at?: string
          created_by: string
          created_by_name: string
          description: string
          due_date?: string | null
          expected_book_cents?: number | null
          id?: string
          issue_date: string
          kind: string
          notes?: string | null
          number?: number | null
          override_reason?: string | null
          party_doc_number_snapshot?: string | null
          party_doc_type_snapshot?: number | null
          party_id?: string | null
          party_iva_condition_snapshot?: string | null
          party_name_snapshot?: string | null
          period_id: string
          point_of_sale?: number | null
          recurring_expense_id?: string | null
          related_document_id?: string | null
          replaces_document_id?: string | null
          reverses_document_id?: string | null
          seq: number
          settles_commissions?: boolean
          shift?: string | null
          status?: string
          tenant_id: string
          total_cents: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
          voucher_type?: string | null
          warnings_ack?: string[]
        }
        Update: {
          accounting_date?: string
          afip_voucher_code?: number | null
          branch_id?: string | null
          bundle_id?: string
          control_account_id?: string | null
          corrects_document_id?: string | null
          counted_cents?: number | null
          created_at?: string
          created_by?: string
          created_by_name?: string
          description?: string
          due_date?: string | null
          expected_book_cents?: number | null
          id?: string
          issue_date?: string
          kind?: string
          notes?: string | null
          number?: number | null
          override_reason?: string | null
          party_doc_number_snapshot?: string | null
          party_doc_type_snapshot?: number | null
          party_id?: string | null
          party_iva_condition_snapshot?: string | null
          party_name_snapshot?: string | null
          period_id?: string
          point_of_sale?: number | null
          recurring_expense_id?: string | null
          related_document_id?: string | null
          replaces_document_id?: string | null
          reverses_document_id?: string | null
          seq?: number
          settles_commissions?: boolean
          shift?: string | null
          status?: string
          tenant_id?: string
          total_cents?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
          voucher_type?: string | null
          warnings_ack?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "adoc_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoc_bundle_same_tenant"
            columns: ["bundle_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_bundles"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_control_same_tenant"
            columns: ["control_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_corrects_same_tenant"
            columns: ["corrects_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_party_same_tenant"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_period_same_tenant"
            columns: ["period_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_periods"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_recurring_same_tenant"
            columns: ["recurring_expense_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_recurring_expenses"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_related_same_tenant"
            columns: ["related_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_replaces_same_tenant"
            columns: ["replaces_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "adoc_reverses_same_tenant"
            columns: ["reverses_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_employee_salaries: {
        Row: {
          employee_id: string
          month: string
          off_books_cents: number
          salary_cents: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          employee_id: string
          month: string
          off_books_cents?: number
          salary_cents: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          employee_id?: string
          month?: string
          off_books_cents?: number
          salary_cents?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_employee_salaries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aes_employee_same_tenant"
            columns: ["employee_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_employees"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_employees: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          pay_frequency: string
          sort: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          pay_frequency?: string
          sort?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          pay_frequency?: string
          sort?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aem_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_fiscal_vouchers: {
        Row: {
          afip_voucher_code: number | null
          book: string
          channel: string | null
          counterparty_doc_number: string
          counterparty_doc_type: number
          counterparty_iva_condition: string
          counterparty_name: string
          counterparty_party_id: string | null
          created_at: string
          document_id: string
          exempt_cents: number
          id: string
          internal_taxes_cents: number
          is_credit_note: boolean
          is_reversal: boolean
          net_0_cents: number
          net_105_cents: number
          net_21_cents: number
          net_25_cents: number
          net_27_cents: number
          net_5_cents: number
          non_taxed_cents: number
          number_from: number
          number_to: number | null
          other_taxes_cents: number
          perc_ganancias_cents: number
          perc_iibb_cents: number
          perc_iva_cents: number
          perc_municipal_cents: number
          period_month: string
          point_of_sale: number
          tenant_id: string
          total_cents: number
          undiscriminated_cents: number
          vat_105_cents: number
          vat_21_cents: number
          vat_25_cents: number
          vat_27_cents: number
          vat_5_cents: number
          vat_computable_cents: number
          voided: boolean
          voucher_date: string
          voucher_type: string
        }
        Insert: {
          afip_voucher_code?: number | null
          book: string
          channel?: string | null
          counterparty_doc_number?: string
          counterparty_doc_type: number
          counterparty_iva_condition: string
          counterparty_name: string
          counterparty_party_id?: string | null
          created_at?: string
          document_id: string
          exempt_cents?: number
          id?: string
          internal_taxes_cents?: number
          is_credit_note: boolean
          is_reversal?: boolean
          net_0_cents?: number
          net_105_cents?: number
          net_21_cents?: number
          net_25_cents?: number
          net_27_cents?: number
          net_5_cents?: number
          non_taxed_cents?: number
          number_from: number
          number_to?: number | null
          other_taxes_cents?: number
          perc_ganancias_cents?: number
          perc_iibb_cents?: number
          perc_iva_cents?: number
          perc_municipal_cents?: number
          period_month: string
          point_of_sale: number
          tenant_id: string
          total_cents: number
          undiscriminated_cents?: number
          vat_105_cents?: number
          vat_21_cents?: number
          vat_25_cents?: number
          vat_27_cents?: number
          vat_5_cents?: number
          vat_computable_cents?: number
          voided?: boolean
          voucher_date: string
          voucher_type: string
        }
        Update: {
          afip_voucher_code?: number | null
          book?: string
          channel?: string | null
          counterparty_doc_number?: string
          counterparty_doc_type?: number
          counterparty_iva_condition?: string
          counterparty_name?: string
          counterparty_party_id?: string | null
          created_at?: string
          document_id?: string
          exempt_cents?: number
          id?: string
          internal_taxes_cents?: number
          is_credit_note?: boolean
          is_reversal?: boolean
          net_0_cents?: number
          net_105_cents?: number
          net_21_cents?: number
          net_25_cents?: number
          net_27_cents?: number
          net_5_cents?: number
          non_taxed_cents?: number
          number_from?: number
          number_to?: number | null
          other_taxes_cents?: number
          perc_ganancias_cents?: number
          perc_iibb_cents?: number
          perc_iva_cents?: number
          perc_municipal_cents?: number
          period_month?: string
          point_of_sale?: number
          tenant_id?: string
          total_cents?: number
          undiscriminated_cents?: number
          vat_105_cents?: number
          vat_21_cents?: number
          vat_25_cents?: number
          vat_27_cents?: number
          vat_5_cents?: number
          vat_computable_cents?: number
          voided?: boolean
          voucher_date?: string
          voucher_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_fiscal_vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "afv_doc_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "afv_party_same_tenant"
            columns: ["counterparty_party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_fiscal_years: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          created_at: string
          end_date: string
          id: string
          opening_number_reserved: boolean
          start_date: string
          status: string
          tenant_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          end_date: string
          id?: string
          opening_number_reserved?: boolean
          start_date: string
          status?: string
          tenant_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          end_date?: string
          id?: string
          opening_number_reserved?: boolean
          start_date?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_fiscal_years_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_guide_progress: {
        Row: {
          done_at: string
          done_by: string | null
          done_by_name: string
          guide: string
          step: string
          tenant_id: string
        }
        Insert: {
          done_at?: string
          done_by?: string | null
          done_by_name: string
          guide: string
          step: string
          tenant_id: string
        }
        Update: {
          done_at?: string
          done_by?: string | null
          done_by_name?: string
          guide?: string
          step?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_guide_progress_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_import_batches: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          counts: Json
          created_at: string
          created_by: string | null
          created_by_name: string
          detected_format: string | null
          file_name: string | null
          file_sha256: string | null
          file_size: number | null
          id: string
          meta: Json
          origin: string
          period_from: string | null
          period_to: string | null
          source: string
          status: string
          tenant_id: string
          treasury_account_id: string | null
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          counts?: Json
          created_at?: string
          created_by?: string | null
          created_by_name: string
          detected_format?: string | null
          file_name?: string | null
          file_sha256?: string | null
          file_size?: number | null
          id?: string
          meta?: Json
          origin?: string
          period_from?: string | null
          period_to?: string | null
          source: string
          status?: string
          tenant_id: string
          treasury_account_id?: string | null
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          counts?: Json
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          detected_format?: string | null
          file_name?: string | null
          file_sha256?: string | null
          file_size?: number | null
          id?: string
          meta?: Json
          origin?: string
          period_from?: string | null
          period_to?: string | null
          source?: string
          status?: string
          tenant_id?: string
          treasury_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_import_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aibt_treasury_fk"
            columns: ["treasury_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_treasury_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_import_items: {
        Row: {
          batch_id: string
          created_at: string
          data: Json
          duplicate_of: string | null
          id: string
          issues: Json
          natural_key: string
          proposal_keys: string[]
          row_no: number
          source_family: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          data: Json
          duplicate_of?: string | null
          id?: string
          issues?: Json
          natural_key: string
          proposal_keys?: string[]
          row_no: number
          source_family: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          data?: Json
          duplicate_of?: string | null
          id?: string
          issues?: Json
          natural_key?: string
          proposal_keys?: string[]
          row_no?: number
          source_family?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_import_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aiit_batch_fk"
            columns: ["batch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_import_batches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aiit_dup_fk"
            columns: ["duplicate_of", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_import_items"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_import_layouts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mapping: Json
          signature: string
          source: string
          tenant_id: string
          treasury_account_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mapping: Json
          signature: string
          source: string
          tenant_id: string
          treasury_account_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mapping?: Json
          signature?: string
          source?: string
          tenant_id?: string
          treasury_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_import_layouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ailo_treasury_fk"
            columns: ["treasury_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_treasury_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_import_proposals: {
        Row: {
          attempt: number
          batch_id: string
          client_ref: string
          created_at: string
          document_id: string | null
          error: Json | null
          form: string
          form_values: Json
          id: string
          key: string
          needs: Json
          posted_at: string | null
          preview_hash: string | null
          previous_document_id: string | null
          status: string
          summary: Json
          tenant_id: string
          updated_at: string
          warnings_ack: string[]
        }
        Insert: {
          attempt?: number
          batch_id: string
          client_ref: string
          created_at?: string
          document_id?: string | null
          error?: Json | null
          form: string
          form_values: Json
          id?: string
          key: string
          needs?: Json
          posted_at?: string | null
          preview_hash?: string | null
          previous_document_id?: string | null
          status?: string
          summary: Json
          tenant_id: string
          updated_at?: string
          warnings_ack?: string[]
        }
        Update: {
          attempt?: number
          batch_id?: string
          client_ref?: string
          created_at?: string
          document_id?: string | null
          error?: Json | null
          form?: string
          form_values?: Json
          id?: string
          key?: string
          needs?: Json
          posted_at?: string | null
          preview_hash?: string | null
          previous_document_id?: string | null
          status?: string
          summary?: Json
          tenant_id?: string
          updated_at?: string
          warnings_ack?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "acc_import_proposals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aipr_batch_fk"
            columns: ["batch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_import_batches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aipr_doc_fk"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aipr_prev_doc_fk"
            columns: ["previous_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_import_rules: {
        Row: {
          action: Json
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          label: string
          match: Json
          priority: number
          source: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action: Json
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          match: Json
          priority?: number
          source: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action?: Json
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          match?: Json
          priority?: number
          source?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_import_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_journal_entries: {
        Row: {
          created_at: string
          created_by: string
          created_by_name: string
          description: string
          document_id: string
          entry_date: string
          fiscal_year_id: string
          id: string
          is_mirror: boolean | null
          kind: string
          number: number | null
          order_key: number | null
          period_id: string
          posting_seq: number
          status: string
          tenant_id: string
          total_cents: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_name: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          created_by_name: string
          description: string
          document_id: string
          entry_date: string
          fiscal_year_id: string
          id?: string
          is_mirror?: boolean | null
          kind: string
          number?: number | null
          order_key?: number | null
          period_id: string
          posting_seq?: never
          status?: string
          tenant_id: string
          total_cents: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          created_by_name?: string
          description?: string
          document_id?: string
          entry_date?: string
          fiscal_year_id?: string
          id?: string
          is_mirror?: boolean | null
          kind?: string
          number?: number | null
          order_key?: number | null
          period_id?: string
          posting_seq?: never
          status?: string
          tenant_id?: string
          total_cents?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aje_document_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aje_fy_same_tenant"
            columns: ["fiscal_year_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_fiscal_years"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aje_period_same_tenant"
            columns: ["period_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_periods"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_journal_lines: {
        Row: {
          account_id: string
          amount_cents: number
          document_id: string
          document_line_id: string
          due_date: string | null
          entry_date: string
          entry_id: string
          id: string
          line_no: number
          memo: string | null
          party_id: string | null
          side: Database["public"]["Enums"]["acc_side"]
          tenant_id: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          document_id: string
          document_line_id: string
          due_date?: string | null
          entry_date: string
          entry_id: string
          id?: string
          line_no: number
          memo?: string | null
          party_id?: string | null
          side: Database["public"]["Enums"]["acc_side"]
          tenant_id: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          document_id?: string
          document_line_id?: string
          due_date?: string | null
          entry_date?: string
          entry_id?: string
          id?: string
          line_no?: number
          memo?: string | null
          party_id?: string | null
          side?: Database["public"]["Enums"]["acc_side"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_journal_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ajl_account_same_tenant"
            columns: ["account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ajl_doc_line_same_tenant"
            columns: ["document_line_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_document_lines"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ajl_document_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ajl_entry_same_tenant"
            columns: ["entry_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_journal_entries"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ajl_party_same_tenant"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_line_reimputations: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string
          document_id: string
          document_line_id: string
          from_account_id: string
          id: string
          reason: string | null
          tenant_id: string
          to_account_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name: string
          document_id: string
          document_line_id: string
          from_account_id: string
          id?: string
          reason?: string | null
          tenant_id: string
          to_account_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          document_id?: string
          document_line_id?: string
          from_account_id?: string
          id?: string
          reason?: string | null
          tenant_id?: string
          to_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_line_reimputations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alr_doc_same_tenant"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "alr_from_same_tenant"
            columns: ["from_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "alr_line_same_tenant"
            columns: ["document_line_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_document_lines"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "alr_to_same_tenant"
            columns: ["to_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_mp_connections: {
        Row: {
          channel_methods: Json
          created_at: string
          created_by: string | null
          day_cutoff_hour: number
          id: string
          last_error_key: string | null
          last_sync_at: string | null
          last_sync_status: string | null
          mp_user_id: number | null
          party_id: string
          pending_report: Json | null
          report_config_applied_at: string | null
          scopes: string[] | null
          site_id: string | null
          status: string
          synced_through: string | null
          tenant_id: string
          token_last4: string | null
          treasury_account_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channel_methods?: Json
          created_at?: string
          created_by?: string | null
          day_cutoff_hour?: number
          id?: string
          last_error_key?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          mp_user_id?: number | null
          party_id: string
          pending_report?: Json | null
          report_config_applied_at?: string | null
          scopes?: string[] | null
          site_id?: string | null
          status?: string
          synced_through?: string | null
          tenant_id: string
          token_last4?: string | null
          treasury_account_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channel_methods?: Json
          created_at?: string
          created_by?: string | null
          day_cutoff_hour?: number
          id?: string
          last_error_key?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          mp_user_id?: number | null
          party_id?: string
          pending_report?: Json | null
          report_config_applied_at?: string | null
          scopes?: string[] | null
          site_id?: string | null
          status?: string
          synced_through?: string | null
          tenant_id?: string
          token_last4?: string | null
          treasury_account_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_mp_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ampc_party_fk"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ampc_treasury_fk"
            columns: ["treasury_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_treasury_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_parties: {
        Row: {
          active: boolean
          address: string | null
          commission_bp: number | null
          commission_vat_mode: string
          contacts: Json
          created_at: string
          created_by: string | null
          default_account_id: string | null
          default_voucher_type: string | null
          delivery_days: number[]
          email: string | null
          id: string
          iibb_withholding_bp: number | null
          income_tax_withholding_bp: number | null
          iva_condition: string
          kind: string
          name: string
          notes: string | null
          order_lead_days: number | null
          payable_account_id: string
          payment_term_days: number
          phone: string | null
          receivable_account_id: string
          sircupa_bp: number | null
          system_key: string | null
          tax_id: string | null
          tax_id_type: string
          tenant_id: string
          trade_name: string | null
          updated_at: string
          updated_by: string | null
          vat_withholding_bp: number | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          commission_bp?: number | null
          commission_vat_mode?: string
          contacts?: Json
          created_at?: string
          created_by?: string | null
          default_account_id?: string | null
          default_voucher_type?: string | null
          delivery_days?: number[]
          email?: string | null
          id?: string
          iibb_withholding_bp?: number | null
          income_tax_withholding_bp?: number | null
          iva_condition?: string
          kind: string
          name: string
          notes?: string | null
          order_lead_days?: number | null
          payable_account_id: string
          payment_term_days?: number
          phone?: string | null
          receivable_account_id: string
          sircupa_bp?: number | null
          system_key?: string | null
          tax_id?: string | null
          tax_id_type?: string
          tenant_id: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_withholding_bp?: number | null
        }
        Update: {
          active?: boolean
          address?: string | null
          commission_bp?: number | null
          commission_vat_mode?: string
          contacts?: Json
          created_at?: string
          created_by?: string | null
          default_account_id?: string | null
          default_voucher_type?: string | null
          delivery_days?: number[]
          email?: string | null
          id?: string
          iibb_withholding_bp?: number | null
          income_tax_withholding_bp?: number | null
          iva_condition?: string
          kind?: string
          name?: string
          notes?: string | null
          order_lead_days?: number | null
          payable_account_id?: string
          payment_term_days?: number
          phone?: string | null
          receivable_account_id?: string
          sircupa_bp?: number | null
          system_key?: string | null
          tax_id?: string | null
          tax_id_type?: string
          tenant_id?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_withholding_bp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_parties_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apt_default_account_same_tenant"
            columns: ["default_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "apt_payable_same_tenant"
            columns: ["payable_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "apt_receivable_same_tenant"
            columns: ["receivable_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_payment_budgets: {
        Row: {
          amount_cents: number
          branch_id: string
          created_at: string
          created_by: string | null
          party_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          week_start: string
        }
        Insert: {
          amount_cents?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          party_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          week_start: string
        }
        Update: {
          amount_cents?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          party_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "apb_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_payment_budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apb_party_same_tenant"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_payroll_accruals: {
        Row: {
          client_ref: string
          created_at: string
          created_by: string | null
          month: string
          tenant_id: string
        }
        Insert: {
          client_ref: string
          created_at?: string
          created_by?: string | null
          month: string
          tenant_id: string
        }
        Update: {
          client_ref?: string
          created_at?: string
          created_by?: string | null
          month?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_payroll_accruals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_payroll_movements: {
        Row: {
          client_ref: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          kind: string
          month: string
          off_books: boolean
          overtime: boolean
          period_from: string | null
          period_to: string | null
          tenant_id: string
        }
        Insert: {
          client_ref: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          kind: string
          month: string
          off_books?: boolean
          overtime?: boolean
          period_from?: string | null
          period_to?: string | null
          tenant_id: string
        }
        Update: {
          client_ref?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          kind?: string
          month?: string
          off_books?: boolean
          overtime?: boolean
          period_from?: string | null
          period_to?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_payroll_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apm_employee_same_tenant"
            columns: ["employee_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_employees"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_period_events: {
        Row: {
          action: string
          actor_id: string
          actor_name: string
          created_at: string
          fiscal_year_id: string | null
          id: string
          payload: Json
          period_id: string | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_name: string
          created_at?: string
          fiscal_year_id?: string | null
          id?: string
          payload?: Json
          period_id?: string | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_name?: string
          created_at?: string
          fiscal_year_id?: string | null
          id?: string
          payload?: Json
          period_id?: string | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_period_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apev_fy_same_tenant"
            columns: ["fiscal_year_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_fiscal_years"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "apev_period_same_tenant"
            columns: ["period_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_periods"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          created_at: string
          debit_total_cents: number | null
          ends_on: string
          entries_count: number | null
          fiscal_year_id: string
          id: string
          iva_settlement_document_id: string | null
          kind: string
          month: string
          number_from: number | null
          number_to: number | null
          snapshot_hash: string | null
          starts_on: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          debit_total_cents?: number | null
          ends_on: string
          entries_count?: number | null
          fiscal_year_id: string
          id?: string
          iva_settlement_document_id?: string | null
          kind?: string
          month: string
          number_from?: number | null
          number_to?: number | null
          snapshot_hash?: string | null
          starts_on: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          debit_total_cents?: number | null
          ends_on?: string
          entries_count?: number | null
          fiscal_year_id?: string
          id?: string
          iva_settlement_document_id?: string | null
          kind?: string
          month?: string
          number_from?: number | null
          number_to?: number | null
          snapshot_hash?: string | null
          starts_on?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aper_fy_same_tenant"
            columns: ["fiscal_year_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_fiscal_years"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "aper_iva_doc_same_tenant"
            columns: ["iva_settlement_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_recurring_expenses: {
        Row: {
          account_id: string
          active: boolean
          amount_cents: number | null
          archived_at: string | null
          branch_id: string
          breakdown: Json
          created_at: string
          created_by: string | null
          due_day: number
          ends_on: string | null
          frequency: string
          id: string
          installments_total: number | null
          last_document_id: string | null
          loaded_due: string | null
          name: string
          next_due_date: string
          notes: string | null
          party_id: string | null
          remind_days_before: number
          skipped_due: string | null
          tenant_id: string
          treasury_account_id: string | null
          updated_at: string
          updated_by: string | null
          vat_rate_bp: number | null
          voucher_type: string | null
        }
        Insert: {
          account_id: string
          active?: boolean
          amount_cents?: number | null
          archived_at?: string | null
          branch_id?: string
          breakdown?: Json
          created_at?: string
          created_by?: string | null
          due_day: number
          ends_on?: string | null
          frequency?: string
          id?: string
          installments_total?: number | null
          last_document_id?: string | null
          loaded_due?: string | null
          name: string
          next_due_date: string
          notes?: string | null
          party_id?: string | null
          remind_days_before?: number
          skipped_due?: string | null
          tenant_id: string
          treasury_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_rate_bp?: number | null
          voucher_type?: string | null
        }
        Update: {
          account_id?: string
          active?: boolean
          amount_cents?: number | null
          archived_at?: string | null
          branch_id?: string
          breakdown?: Json
          created_at?: string
          created_by?: string | null
          due_day?: number
          ends_on?: string | null
          frequency?: string
          id?: string
          installments_total?: number | null
          last_document_id?: string | null
          loaded_due?: string | null
          name?: string
          next_due_date?: string
          notes?: string | null
          party_id?: string | null
          remind_days_before?: number
          skipped_due?: string | null
          tenant_id?: string
          treasury_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_rate_bp?: number | null
          voucher_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arx_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_recurring_expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arx_account_same_tenant"
            columns: ["account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "arx_last_doc_same_tenant"
            columns: ["last_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "arx_party_same_tenant"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "arx_treasury_same_tenant"
            columns: ["treasury_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_treasury_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_sales_methods: {
        Row: {
          active: boolean
          channel: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          party_id: string | null
          settlement_days: number
          sort: number
          system_key: string | null
          tenant_id: string
          treasury_account_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          name: string
          party_id?: string | null
          settlement_days?: number
          sort?: number
          system_key?: string | null
          tenant_id: string
          treasury_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          party_id?: string | null
          settlement_days?: number
          sort?: number
          system_key?: string | null
          tenant_id?: string
          treasury_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acc_sales_methods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asm_party_same_tenant"
            columns: ["party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "asm_treasury_same_tenant"
            columns: ["treasury_account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_treasury_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_sales_points: {
        Row: {
          active: boolean
          created_at: string
          default_channel: string
          id: string
          label: string
          number: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_channel?: string
          id?: string
          label: string
          number: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_channel?: string
          id?: string
          label?: string
          number?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_sales_points_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_sales_targets: {
        Row: {
          branch_id: string
          day: string
          note: string | null
          target_cents: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id?: string
          day: string
          note?: string | null
          target_cents?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          day?: string
          note?: string | null
          target_cents?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "astg_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_sales_targets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_secrets: {
        Row: {
          arca_connection_id: string | null
          ciphertext: string
          created_at: string
          expires_at: string | null
          id: string
          key_version: number
          mp_connection_id: string | null
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          arca_connection_id?: string | null
          ciphertext: string
          created_at?: string
          expires_at?: string | null
          id?: string
          key_version?: number
          mp_connection_id?: string | null
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          arca_connection_id?: string | null
          ciphertext?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          key_version?: number
          mp_connection_id?: string | null
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_secrets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asec_arca_fk"
            columns: ["arca_connection_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_arca_connections"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "asec_mp_fk"
            columns: ["mp_connection_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_mp_connections"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_settings: {
        Row: {
          activity_start_date: string | null
          bank_tax_credit_computable_bp: number
          bank_tax_debit_computable_bp: number
          books_start_date: string
          closed_period_void_iva_mode: string
          created_at: string
          created_by: string | null
          cuit: string | null
          doc_seq: number
          due_soon_days: number
          fiscal_address: string | null
          fiscal_year_end_month: number
          iibb_due_day: number
          iibb_jurisdiction_code: number
          iibb_number: string | null
          iibb_regime: string
          iva_condition: string
          iva_due_day: number
          iva_settlement_mode: string
          legal_name: string
          opening_status: string
          setup_completed_at: string | null
          tax_settings: Json
          tenant_id: string
          uninvoiced_sales_mode: string
          updated_at: string
          updated_by: string | null
          vat_tolerance_cents: number
        }
        Insert: {
          activity_start_date?: string | null
          bank_tax_credit_computable_bp?: number
          bank_tax_debit_computable_bp?: number
          books_start_date: string
          closed_period_void_iva_mode?: string
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          doc_seq?: number
          due_soon_days?: number
          fiscal_address?: string | null
          fiscal_year_end_month?: number
          iibb_due_day?: number
          iibb_jurisdiction_code?: number
          iibb_number?: string | null
          iibb_regime?: string
          iva_condition?: string
          iva_due_day?: number
          iva_settlement_mode?: string
          legal_name: string
          opening_status?: string
          setup_completed_at?: string | null
          tax_settings?: Json
          tenant_id: string
          uninvoiced_sales_mode?: string
          updated_at?: string
          updated_by?: string | null
          vat_tolerance_cents?: number
        }
        Update: {
          activity_start_date?: string | null
          bank_tax_credit_computable_bp?: number
          bank_tax_debit_computable_bp?: number
          books_start_date?: string
          closed_period_void_iva_mode?: string
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          doc_seq?: number
          due_soon_days?: number
          fiscal_address?: string | null
          fiscal_year_end_month?: number
          iibb_due_day?: number
          iibb_jurisdiction_code?: number
          iibb_number?: string | null
          iibb_regime?: string
          iva_condition?: string
          iva_due_day?: number
          iva_settlement_mode?: string
          legal_name?: string
          opening_status?: string
          setup_completed_at?: string | null
          tax_settings?: Json
          tenant_id?: string
          uninvoiced_sales_mode?: string
          updated_at?: string
          updated_by?: string | null
          vat_tolerance_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "acc_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_tex_actions: {
        Row: {
          created_at: string
          decided_at: string | null
          document_id: string | null
          id: string
          kind: string
          payload: Json
          result: Json | null
          status: string
          tenant_id: string
          thread_id: string
          ticket: Json
          tool_use_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          document_id?: string | null
          id?: string
          kind: string
          payload: Json
          result?: Json | null
          status?: string
          tenant_id: string
          thread_id: string
          ticket: Json
          tool_use_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          document_id?: string | null
          id?: string
          kind?: string
          payload?: Json
          result?: Json | null
          status?: string
          tenant_id?: string
          thread_id?: string
          ticket?: Json
          tool_use_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_tex_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atxa_thread_same_tenant"
            columns: ["thread_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_tex_threads"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_tex_messages: {
        Row: {
          content: Json
          created_at: string
          id: string
          role: string
          seq: number
          tenant_id: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          role: string
          seq: number
          tenant_id: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          role?: string
          seq?: number
          tenant_id?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_tex_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atxm_thread_same_tenant"
            columns: ["thread_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_tex_threads"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_tex_threads: {
        Row: {
          cached_tokens: number
          created_at: string
          id: string
          input_tokens: number
          last_context_tokens: number
          last_screen_hash: string | null
          output_tokens: number
          pending: Json | null
          tenant_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cached_tokens?: number
          created_at?: string
          id?: string
          input_tokens?: number
          last_context_tokens?: number
          last_screen_hash?: string | null
          output_tokens?: number
          pending?: Json | null
          tenant_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cached_tokens?: number
          created_at?: string
          id?: string
          input_tokens?: number
          last_context_tokens?: number
          last_screen_hash?: string | null
          output_tokens?: number
          pending?: Json | null
          tenant_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_tex_threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      acc_treasury_accounts: {
        Row: {
          account_id: string
          account_number: string | null
          active: boolean
          alias: string | null
          allow_negative: boolean
          bank_name: string | null
          bank_party_id: string | null
          branch_id: string | null
          cbu_cvu: string | null
          charges_bank_tax: boolean | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          last_checked_by: string | null
          last_checked_on: string | null
          name: string
          sort: number
          system_key: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          account_number?: string | null
          active?: boolean
          alias?: string | null
          allow_negative?: boolean
          bank_name?: string | null
          bank_party_id?: string | null
          branch_id?: string | null
          cbu_cvu?: string | null
          charges_bank_tax?: boolean | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          last_checked_by?: string | null
          last_checked_on?: string | null
          name: string
          sort?: number
          system_key?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          account_number?: string | null
          active?: boolean
          alias?: string | null
          allow_negative?: boolean
          bank_name?: string | null
          bank_party_id?: string | null
          branch_id?: string | null
          cbu_cvu?: string | null
          charges_bank_tax?: boolean | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_checked_by?: string | null
          last_checked_on?: string | null
          name?: string
          sort?: number
          system_key?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "atr_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "acc_treasury_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atr_account_same_tenant"
            columns: ["account_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_accounts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "atr_bank_party_same_tenant"
            columns: ["bank_party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_upload_link_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          link_id: string
          mime_type: string
          path: string
          size_bytes: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          link_id: string
          mime_type: string
          path: string
          size_bytes: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          link_id?: string
          mime_type?: string
          path?: string
          size_bytes?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_upload_link_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aulf_link_same_tenant"
            columns: ["link_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_upload_links"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      acc_upload_links: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          slots: Json
          tenant_id: string
          token_hash: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id: string
          slots: Json
          tenant_id: string
          token_hash: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          slots?: Json
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "acc_upload_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audiences: {
        Row: {
          created_at: string
          customer_count_cached: number
          filters: Json
          id: string
          last_calculated_at: string | null
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_count_cached?: number
          filters?: Json
          id?: string
          last_calculated_at?: string | null
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_count_cached?: number
          filters?: Json
          id?: string
          last_calculated_at?: string | null
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audiences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          payload: Json
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          payload?: Json
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          payload?: Json
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      birthday_marketing: {
        Row: {
          ad_spend_usd_cents: number
          created_at: string
          created_by: string | null
          id: string
          messages: number | null
          month: string
          notes: string | null
          reach: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ad_spend_usd_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          messages?: number | null
          month: string
          notes?: string | null
          reach?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ad_spend_usd_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          messages?: number | null
          month?: string
          notes?: string | null
          reach?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "birthday_marketing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          active: boolean
          address: string | null
          color: string
          created_at: string
          created_by: string | null
          feedback_whatsapp_phone: string | null
          google_maps_review_url: string | null
          id: string
          is_default: boolean
          name: string
          opened_on: string | null
          position: number
          practice_until: string | null
          seat_capacity: number | null
          short_name: string | null
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          feedback_whatsapp_phone?: string | null
          google_maps_review_url?: string | null
          id?: string
          is_default?: boolean
          name: string
          opened_on?: string | null
          position?: number
          practice_until?: string | null
          seat_capacity?: number | null
          short_name?: string | null
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          feedback_whatsapp_phone?: string | null
          google_maps_review_url?: string | null
          id?: string
          is_default?: boolean
          name?: string
          opened_on?: string | null
          position?: number
          practice_until?: string | null
          seat_capacity?: number | null
          short_name?: string | null
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          claimed_at: string | null
          customer_id: string
          delivered_at: string | null
          error: string | null
          id: string
          message_id: string | null
          queued_at: string | null
          read_at: string | null
          replied_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["recipient_status"]
        }
        Insert: {
          broadcast_id: string
          claimed_at?: string | null
          customer_id: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          queued_at?: string | null
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Update: {
          broadcast_id?: string
          claimed_at?: string | null
          customer_id?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          queued_at?: string | null
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "broadcast_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "broadcast_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "broadcast_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          audience_id: string
          channel_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          scheduled_at: string | null
          started_at: string | null
          stats: Json
          status: Database["public"]["Enums"]["broadcast_status"]
          template_id: string
          tenant_id: string
          updated_at: string
          variable_mapping: Json
        }
        Insert: {
          audience_id: string
          channel_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          started_at?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["broadcast_status"]
          template_id: string
          tenant_id: string
          updated_at?: string
          variable_mapping?: Json
        }
        Update: {
          audience_id?: string
          channel_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          started_at?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["broadcast_status"]
          template_id?: string
          tenant_id?: string
          updated_at?: string
          variable_mapping?: Json
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_audience_id_fkey"
            columns: ["audience_id"]
            isOneToOne: false
            referencedRelation: "audiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cake_options: {
        Row: {
          active: boolean
          base: string
          created_at: string
          fillings: string[]
          id: string
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          base: string
          created_at?: string
          fillings: string[]
          id?: string
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          base?: string
          created_at?: string
          fillings?: string[]
          id?: string
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cake_options_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          connected_at: string | null
          created_at: string
          display_name: string | null
          encrypted_access_token: string | null
          external_account_id: string
          external_phone_number_id: string | null
          id: string
          last_error: string | null
          status: Database["public"]["Enums"]["channel_status"]
          tenant_id: string
          token_expires_at: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          encrypted_access_token?: string | null
          external_account_id: string
          external_phone_number_id?: string | null
          id?: string
          last_error?: string | null
          status?: Database["public"]["Enums"]["channel_status"]
          tenant_id: string
          token_expires_at?: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          encrypted_access_token?: string | null
          external_account_id?: string
          external_phone_number_id?: string | null
          id?: string
          last_error?: string | null
          status?: Database["public"]["Enums"]["channel_status"]
          tenant_id?: string
          token_expires_at?: string | null
          type?: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_bonus_rules: {
        Row: {
          active: boolean
          bonus_per_guest_cents: number
          created_at: string
          id: string
          scope: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          bonus_per_guest_cents: number
          created_at?: string
          id?: string
          scope: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          bonus_per_guest_cents?: number
          created_at?: string
          id?: string
          scope?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_bonus_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_ledger: {
        Row: {
          base_rate_per_guest_cents: number
          base_total_cents: number
          bonus_per_guest_cents: number
          bonus_total_cents: number
          calculated_at: string
          calculation_version: number
          guests_billed: number
          id: string
          manager_id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          paid_at: string | null
          paid_payout_id: string | null
          payable_cents: number
          reservation_id: string
          split_factor_denominator: number
          split_factor_numerator: number
          tenant_id: string
        }
        Insert: {
          base_rate_per_guest_cents: number
          base_total_cents: number
          bonus_per_guest_cents?: number
          bonus_total_cents?: number
          calculated_at?: string
          calculation_version?: number
          guests_billed: number
          id?: string
          manager_id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          paid_at?: string | null
          paid_payout_id?: string | null
          payable_cents: number
          reservation_id: string
          split_factor_denominator?: number
          split_factor_numerator?: number
          tenant_id: string
        }
        Update: {
          base_rate_per_guest_cents?: number
          base_total_cents?: number
          bonus_per_guest_cents?: number
          bonus_total_cents?: number
          calculated_at?: string
          calculation_version?: number
          guests_billed?: number
          id?: string
          manager_id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          paid_at?: string | null
          paid_payout_id?: string | null
          payable_cents?: number
          reservation_id?: string
          split_factor_denominator?: number
          split_factor_numerator?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_ledger_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "reservation_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_ledger_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "salon_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rate_tiers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_guests: number | null
          meal_type: Database["public"]["Enums"]["meal_type"]
          min_guests: number
          rate_per_guest_cents: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_guests?: number | null
          meal_type: Database["public"]["Enums"]["meal_type"]
          min_guests: number
          rate_per_guest_cents: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_guests?: number | null
          meal_type?: Database["public"]["Enums"]["meal_type"]
          min_guests?: number
          rate_per_guest_cents?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_rate_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tag_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          conversation_id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          conversation_id: string
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          conversation_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tag_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "conversation_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel_id: string
          created_at: string
          customer_id: string | null
          external_user_id: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_direction:
            | Database["public"]["Enums"]["message_direction"]
            | null
          last_message_preview: string | null
          last_read_at: string | null
          tenant_id: string
          unread_count: number
        }
        Insert: {
          channel_id: string
          created_at?: string
          customer_id?: string | null
          external_user_id: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?:
            | Database["public"]["Enums"]["message_direction"]
            | null
          last_message_preview?: string | null
          last_read_at?: string | null
          tenant_id: string
          unread_count?: number
        }
        Update: {
          channel_id?: string
          created_at?: string
          customer_id?: string | null
          external_user_id?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?:
            | Database["public"]["Enums"]["message_direction"]
            | null
          last_message_preview?: string | null
          last_read_at?: string | null
          tenant_id?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_capture_links: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          slug: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          slug: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_capture_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_capture_submissions: {
        Row: {
          created_at: string
          customer_id: string | null
          first_name: string
          id: string
          ip: string | null
          last_name: string
          link_id: string
          opt_in_marketing: boolean
          phone: string
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          first_name: string
          id?: string
          ip?: string | null
          last_name: string
          link_id: string
          opt_in_marketing?: boolean
          phone: string
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          first_name?: string
          id?: string
          ip?: string | null
          last_name?: string
          link_id?: string
          opt_in_marketing?: boolean
          phone?: string
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_capture_submissions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_capture_submissions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_capture_submissions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_capture_submissions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_capture_submissions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "customer_capture_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_capture_submissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_credentials: {
        Row: {
          created_at: string
          customer_id: string
          failed_attempts: number
          locked_until: string | null
          password_hash: string
          password_set_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          failed_attempts?: number
          locked_until?: string | null
          password_hash: string
          password_set_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          failed_attempts?: number
          locked_until?: string | null
          password_hash?: string
          password_set_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credentials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credentials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_credentials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_credentials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_password_resets: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          customer_id: string
          expires_at: string
          id: string
          request_ip: string | null
          reset_ticket: string | null
          tenant_id: string
          ticket_expires_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          customer_id: string
          expires_at: string
          id?: string
          request_ip?: string | null
          reset_ticket?: string | null
          tenant_id: string
          ticket_expires_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          customer_id?: string
          expires_at?: string
          id?: string
          request_ip?: string | null
          reset_ticket?: string | null
          tenant_id?: string
          ticket_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_password_resets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_password_resets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_password_resets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_password_resets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_password_resets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_punch_cards: {
        Row: {
          completed_at: string | null
          created_at: string
          current_stamps: number
          customer_id: string
          expired_at: string | null
          id: string
          reward_redemption_id: string | null
          started_at: string
          template_id: string
          tenant_id: string
          threshold_snapshot: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_stamps?: number
          customer_id: string
          expired_at?: string | null
          id?: string
          reward_redemption_id?: string | null
          started_at?: string
          template_id: string
          tenant_id: string
          threshold_snapshot: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_stamps?: number
          customer_id?: string
          expired_at?: string | null
          id?: string
          reward_redemption_id?: string | null
          started_at?: string
          template_id?: string
          tenant_id?: string
          threshold_snapshot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_punch_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_punch_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_punch_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_punch_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_punch_cards_reward_redemption_id_fkey"
            columns: ["reward_redemption_id"]
            isOneToOne: false
            referencedRelation: "reward_redemptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_punch_cards_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "punch_card_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_punch_cards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tag_assignments: {
        Row: {
          assigned_at: string
          customer_id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          customer_id: string
          tag_id: string
        }
        Update: {
          assigned_at?: string
          customer_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tag_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tag_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_tag_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_tag_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "customer_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          acquisition_channel: Database["public"]["Enums"]["customer_acquisition_channel"]
          birthdate: string | null
          category_points: number
          created_at: string
          current_tier_id: string | null
          deleted_at: string | null
          email: string | null
          email_opt_in_at: string | null
          first_name: string
          id: string
          is_blocked: boolean
          last_name: string
          last_visit_at: string | null
          lifetime_points_earned: number
          notes: string | null
          opt_in_at: string | null
          opt_in_ip: string | null
          opt_in_marketing: boolean
          phone: string
          points_balance: number
          qr_token: string
          qr_token_generated_at: string
          service_alerts: Database["public"]["Enums"]["service_alert"][]
          source: Database["public"]["Enums"]["customer_source"]
          tenant_id: string
          total_spent_cents: number
          total_visits: number
          updated_at: string
        }
        Insert: {
          acquisition_channel?: Database["public"]["Enums"]["customer_acquisition_channel"]
          birthdate?: string | null
          category_points?: number
          created_at?: string
          current_tier_id?: string | null
          deleted_at?: string | null
          email?: string | null
          email_opt_in_at?: string | null
          first_name: string
          id?: string
          is_blocked?: boolean
          last_name: string
          last_visit_at?: string | null
          lifetime_points_earned?: number
          notes?: string | null
          opt_in_at?: string | null
          opt_in_ip?: string | null
          opt_in_marketing?: boolean
          phone: string
          points_balance?: number
          qr_token?: string
          qr_token_generated_at?: string
          service_alerts?: Database["public"]["Enums"]["service_alert"][]
          source?: Database["public"]["Enums"]["customer_source"]
          tenant_id: string
          total_spent_cents?: number
          total_visits?: number
          updated_at?: string
        }
        Update: {
          acquisition_channel?: Database["public"]["Enums"]["customer_acquisition_channel"]
          birthdate?: string | null
          category_points?: number
          created_at?: string
          current_tier_id?: string | null
          deleted_at?: string | null
          email?: string | null
          email_opt_in_at?: string | null
          first_name?: string
          id?: string
          is_blocked?: boolean
          last_name?: string
          last_visit_at?: string | null
          lifetime_points_earned?: number
          notes?: string | null
          opt_in_at?: string | null
          opt_in_ip?: string | null
          opt_in_marketing?: boolean
          phone?: string
          points_balance?: number
          qr_token?: string
          qr_token_generated_at?: string
          service_alerts?: Database["public"]["Enums"]["service_alert"][]
          source?: Database["public"]["Enums"]["customer_source"]
          tenant_id?: string
          total_spent_cents?: number
          total_visits?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_current_tier_id_fkey"
            columns: ["current_tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_experiences: {
        Row: {
          accent_hex: string | null
          allow_full_payment: boolean
          card_image_url: string | null
          cash_price_cents: number | null
          created_at: string
          created_by: string | null
          deposit_cents: number
          gallery: Json
          hero_url: string | null
          id: string
          max_party_size: number
          min_party_size: number
          poster_url: string | null
          price_cents: number
          price_note: string | null
          published: boolean
          schedule_note: string | null
          series: string | null
          slug: string
          sort_order: number
          steps: Json
          steps_note: string | null
          synopsis: string | null
          tagline: string | null
          template_id: string
          tenant_id: string
          terms: string | null
          title: string
          updated_at: string
          updated_by: string | null
          video_url: string | null
        }
        Insert: {
          accent_hex?: string | null
          allow_full_payment?: boolean
          card_image_url?: string | null
          cash_price_cents?: number | null
          created_at?: string
          created_by?: string | null
          deposit_cents?: number
          gallery?: Json
          hero_url?: string | null
          id?: string
          max_party_size?: number
          min_party_size?: number
          poster_url?: string | null
          price_cents: number
          price_note?: string | null
          published?: boolean
          schedule_note?: string | null
          series?: string | null
          slug: string
          sort_order?: number
          steps?: Json
          steps_note?: string | null
          synopsis?: string | null
          tagline?: string | null
          template_id: string
          tenant_id: string
          terms?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          video_url?: string | null
        }
        Update: {
          accent_hex?: string | null
          allow_full_payment?: boolean
          card_image_url?: string | null
          cash_price_cents?: number | null
          created_at?: string
          created_by?: string | null
          deposit_cents?: number
          gallery?: Json
          hero_url?: string | null
          id?: string
          max_party_size?: number
          min_party_size?: number
          poster_url?: string | null
          price_cents?: number
          price_note?: string | null
          published?: boolean
          schedule_note?: string | null
          series?: string | null
          slug?: string
          sort_order?: number
          steps?: Json
          steps_note?: string | null
          synopsis?: string | null
          tagline?: string | null
          template_id?: string
          tenant_id?: string
          terms?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_experiences_template_same_tenant"
            columns: ["template_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "scheduled_event_templates"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "event_experiences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plan_areas: {
        Row: {
          branch_id: string
          created_at: string
          height: number
          id: string
          name: string
          number_start: number
          position: number
          tenant_id: string
          updated_at: string
          width: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          height?: number
          id?: string
          name: string
          number_start?: number
          position?: number
          tenant_id: string
          updated_at?: string
          width?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          height?: number
          id?: string
          name?: string
          number_start?: number
          position?: number
          tenant_id?: string
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "floor_plan_areas_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "floor_plan_areas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plan_elements: {
        Row: {
          area_id: string
          color: string | null
          corner_radius: number
          created_at: string
          height: number
          id: string
          kind: Database["public"]["Enums"]["floor_element_kind"]
          label: string | null
          physical_table_id: string | null
          rotation: number
          shape: Database["public"]["Enums"]["floor_element_shape"]
          tenant_id: string
          updated_at: string
          width: number
          x: number
          y: number
          z_index: number
        }
        Insert: {
          area_id: string
          color?: string | null
          corner_radius?: number
          created_at?: string
          height?: number
          id?: string
          kind: Database["public"]["Enums"]["floor_element_kind"]
          label?: string | null
          physical_table_id?: string | null
          rotation?: number
          shape?: Database["public"]["Enums"]["floor_element_shape"]
          tenant_id: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Update: {
          area_id?: string
          color?: string | null
          corner_radius?: number
          created_at?: string
          height?: number
          id?: string
          kind?: Database["public"]["Enums"]["floor_element_kind"]
          label?: string | null
          physical_table_id?: string | null
          rotation?: number
          shape?: Database["public"]["Enums"]["floor_element_shape"]
          tenant_id?: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "floor_plan_elements_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "floor_plan_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_plan_elements_physical_table_id_fkey"
            columns: ["physical_table_id"]
            isOneToOne: false
            referencedRelation: "physical_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_plan_elements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_edges: {
        Row: {
          created_at: string
          flow_id: string
          id: string
          source_handle: string | null
          source_node_id: string
          target_node_id: string
        }
        Insert: {
          created_at?: string
          flow_id: string
          id?: string
          source_handle?: string | null
          source_node_id: string
          target_node_id: string
        }
        Update: {
          created_at?: string
          flow_id?: string
          id?: string
          source_handle?: string | null
          source_node_id?: string
          target_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_edges_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_edges_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_edges_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_execution_events: {
        Row: {
          action_label: string
          action_type: string
          customer_id: string | null
          detail: Json
          error: string | null
          execution_id: string
          flow_id: string
          id: string
          node_id: string | null
          occurred_at: string
          status: string
          step_position: number | null
          tenant_id: string
        }
        Insert: {
          action_label: string
          action_type: string
          customer_id?: string | null
          detail?: Json
          error?: string | null
          execution_id: string
          flow_id: string
          id?: string
          node_id?: string | null
          occurred_at?: string
          status: string
          step_position?: number | null
          tenant_id: string
        }
        Update: {
          action_label?: string
          action_type?: string
          customer_id?: string | null
          detail?: Json
          error?: string | null
          execution_id?: string
          flow_id?: string
          id?: string
          node_id?: string | null
          occurred_at?: string
          status?: string
          step_position?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_execution_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_execution_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "flow_execution_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "flow_execution_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "flow_execution_events_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "flow_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_execution_events_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_execution_events_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_execution_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_executions: {
        Row: {
          completed_at: string | null
          context: Json
          current_node_id: string | null
          current_step: number
          customer_id: string
          error: string | null
          flow_id: string
          id: string
          next_run_at: string
          started_at: string
          status: Database["public"]["Enums"]["flow_execution_status"]
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          context?: Json
          current_node_id?: string | null
          current_step?: number
          customer_id: string
          error?: string | null
          flow_id: string
          id?: string
          next_run_at?: string
          started_at?: string
          status?: Database["public"]["Enums"]["flow_execution_status"]
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          context?: Json
          current_node_id?: string | null
          current_step?: number
          customer_id?: string
          error?: string | null
          flow_id?: string
          id?: string
          next_run_at?: string
          started_at?: string
          status?: Database["public"]["Enums"]["flow_execution_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_executions_current_node_id_fkey"
            columns: ["current_node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "flow_executions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "flow_executions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "flow_executions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_nodes: {
        Row: {
          config: Json
          created_at: string
          flow_id: string
          id: string
          kind: string
          position: Json
        }
        Insert: {
          config?: Json
          created_at?: string
          flow_id: string
          id?: string
          kind: string
          position?: Json
        }
        Update: {
          config?: Json
          created_at?: string
          flow_id?: string
          id?: string
          kind?: string
          position?: Json
        }
        Relationships: [
          {
            foreignKeyName: "flow_nodes_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_steps: {
        Row: {
          config: Json
          created_at: string
          flow_id: string
          id: string
          position: number
          type: Database["public"]["Enums"]["flow_step_type"]
        }
        Insert: {
          config?: Json
          created_at?: string
          flow_id: string
          id?: string
          position: number
          type: Database["public"]["Enums"]["flow_step_type"]
        }
        Update: {
          config?: Json
          created_at?: string
          flow_id?: string
          id?: string
          position?: number
          type?: Database["public"]["Enums"]["flow_step_type"]
        }
        Relationships: [
          {
            foreignKeyName: "flow_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          tenant_id: string
          trigger_config: Json
          trigger_type: Database["public"]["Enums"]["flow_trigger_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          tenant_id: string
          trigger_config?: Json
          trigger_type: Database["public"]["Enums"]["flow_trigger_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          trigger_config?: Json
          trigger_type?: Database["public"]["Enums"]["flow_trigger_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          kind: string
          locked_at: string | null
          max_attempts: number
          payload: Json
          run_at: string
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_stations: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_stations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_exam_results: {
        Row: {
          answers: Json
          attempt: number
          created_at: string
          device_id: string | null
          duration_seconds: number
          id: string
          left_screen: number
          page_id: string
          score: number
          stations: Json
          submission_id: string
          taker_name: string
          tenant_id: string
          total: number
        }
        Insert: {
          answers?: Json
          attempt?: number
          created_at?: string
          device_id?: string | null
          duration_seconds: number
          id?: string
          left_screen?: number
          page_id: string
          score: number
          stations?: Json
          submission_id: string
          taker_name: string
          tenant_id: string
          total: number
        }
        Update: {
          answers?: Json
          attempt?: number
          created_at?: string
          device_id?: string | null
          duration_seconds?: number
          id?: string
          left_screen?: number
          page_id?: string
          score?: number
          stations?: Json
          submission_id?: string
          taker_name?: string
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "landing_exam_results_page_fk"
            columns: ["page_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "landing_exam_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_page_versions: {
        Row: {
          created_at: string
          created_by: string | null
          html: string
          id: string
          label: string | null
          page_id: string
          size_chars: number | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          html: string
          id?: string
          label?: string | null
          page_id: string
          size_chars?: number | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          html?: string
          id?: string
          label?: string | null
          page_id?: string
          size_chars?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_page_versions_page_fk"
            columns: ["page_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "landing_page_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_page_views: {
        Row: {
          day: string
          page_id: string
          tenant_id: string
          views: number
        }
        Insert: {
          day: string
          page_id: string
          tenant_id: string
          views?: number
        }
        Update: {
          day?: string
          page_id?: string
          tenant_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "landing_page_views_page_fk"
            columns: ["page_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "landing_page_views_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_pages: {
        Row: {
          created_at: string
          html: string
          id: string
          indexable: boolean
          last_viewed_at: string | null
          published: boolean
          published_at: string | null
          slug: string
          tenant_id: string
          title: string
          updated_at: string
          views: number
        }
        Insert: {
          created_at?: string
          html?: string
          id?: string
          indexable?: boolean
          last_viewed_at?: string | null
          published?: boolean
          published_at?: string | null
          slug: string
          tenant_id: string
          title: string
          updated_at?: string
          views?: number
        }
        Update: {
          created_at?: string
          html?: string
          id?: string
          indexable?: boolean
          last_viewed_at?: string | null
          published?: boolean
          published_at?: string | null
          slug?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_tiers: {
        Row: {
          active: boolean
          badge_icon: string | null
          color: string | null
          created_at: string
          id: string
          min_category_points: number
          name: string
          perks: string | null
          sort: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          badge_icon?: string | null
          color?: string | null
          created_at?: string
          id?: string
          min_category_points: number
          name: string
          perks?: string | null
          sort?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          badge_icon?: string | null
          color?: string | null
          created_at?: string
          id?: string
          min_category_points?: number
          name?: string
          perks?: string | null
          sort?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_routine_checks: {
        Row: {
          completed_at: string
          completed_by: string | null
          id: string
          routine_id: string
          slot: number
          tenant_id: string
          week_start: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          id?: string
          routine_id: string
          slot: number
          tenant_id: string
          week_start: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          id?: string
          routine_id?: string
          slot?: number
          tenant_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_routine_checks_routine_id_tenant_id_fkey"
            columns: ["routine_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marketing_routines"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "marketing_routine_checks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_routines: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          position: number
          slots: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          slots?: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          slots?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_routines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_task_files: {
        Row: {
          created_at: string
          created_by: string | null
          file_name: string
          id: string
          kind: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string | null
          task_id: string
          tenant_id: string
          update_id: string | null
          url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_name: string
          id?: string
          kind: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          task_id: string
          tenant_id: string
          update_id?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_name?: string
          id?: string
          kind?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          task_id?: string
          tenant_id?: string
          update_id?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_task_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mtf_task_same_tenant"
            columns: ["task_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marketing_tasks"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "mtf_update_same_tenant"
            columns: ["update_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marketing_task_updates"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      marketing_task_groups: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_task_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_task_people: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: string
          task_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role: string
          task_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: string
          task_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_task_people_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mtp_task_same_tenant"
            columns: ["task_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marketing_tasks"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      marketing_task_updates: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_task_updates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mtu_task_same_tenant"
            columns: ["task_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marketing_tasks"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      marketing_tasks: {
        Row: {
          category: Database["public"]["Enums"]["marketing_task_category"]
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          defined_date: string | null
          due_date: string | null
          file_url: string | null
          group_id: string
          id: string
          ideal_date: string | null
          involved_user_id: string | null
          kind: Database["public"]["Enums"]["marketing_task_kind"]
          notes: string | null
          position: number
          responsible_user_id: string | null
          specifications: string | null
          status: Database["public"]["Enums"]["marketing_task_status"]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["marketing_task_category"]
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          defined_date?: string | null
          due_date?: string | null
          file_url?: string | null
          group_id: string
          id?: string
          ideal_date?: string | null
          involved_user_id?: string | null
          kind?: Database["public"]["Enums"]["marketing_task_kind"]
          notes?: string | null
          position?: number
          responsible_user_id?: string | null
          specifications?: string | null
          status?: Database["public"]["Enums"]["marketing_task_status"]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["marketing_task_category"]
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          defined_date?: string | null
          due_date?: string | null
          file_url?: string | null
          group_id?: string
          id?: string
          ideal_date?: string | null
          involved_user_id?: string | null
          kind?: Database["public"]["Enums"]["marketing_task_kind"]
          notes?: string | null
          position?: number
          responsible_user_id?: string | null
          specifications?: string | null
          status?: Database["public"]["Enums"]["marketing_task_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mt_group_same_tenant"
            columns: ["group_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marketing_task_groups"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      membership_branches: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_branches_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "membership_branches_member_fk"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["tenant_id", "user_id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          active: boolean
          availability: Json | null
          created_at: string
          id: string
          image_url: string | null
          kitchen_first: boolean
          name: string
          parent_id: string | null
          position: number
          station_id: string | null
          tenant_id: string
        }
        Insert: {
          active?: boolean
          availability?: Json | null
          created_at?: string
          id?: string
          image_url?: string | null
          kitchen_first?: boolean
          name: string
          parent_id?: string | null
          position?: number
          station_id?: string | null
          tenant_id: string
        }
        Update: {
          active?: boolean
          availability?: Json | null
          created_at?: string
          id?: string
          image_url?: string | null
          kitchen_first?: boolean
          name?: string
          parent_id?: string | null
          position?: number
          station_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_station_fk"
            columns: ["station_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_branches: {
        Row: {
          available: boolean
          branch_id: string
          created_at: string
          menu_item_id: string
          price_cents: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          available?: boolean
          branch_id: string
          created_at?: string
          menu_item_id: string
          price_cents?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          available?: boolean
          branch_id?: string
          created_at?: string
          menu_item_id?: string
          price_cents?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_branches_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_item_branches_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_branches_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_item_branches_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_item_branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_tag_assignments: {
        Row: {
          menu_item_id: string
          tag_id: string
        }
        Insert: {
          menu_item_id: string
          tag_id: string
        }
        Update: {
          menu_item_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_tag_assignments_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_tag_assignments_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_item_tag_assignments_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_item_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "item_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          description: string | null
          featured: boolean
          id: string
          image_url: string | null
          kitchen_first: boolean | null
          name: string
          points_override: number | null
          position: number
          price_cents: number
          station_id: string | null
          tenant_id: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          kitchen_first?: boolean | null
          name: string
          points_override?: number | null
          position?: number
          price_cents: number
          station_id?: string | null
          tenant_id: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          kitchen_first?: boolean | null
          name?: string
          points_override?: number | null
          position?: number
          price_cents?: number
          station_id?: string | null
          tenant_id?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_station_fk"
            columns: ["station_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifier_groups: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          position: number
          required: boolean
          selection: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          position?: number
          required?: boolean
          selection?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          position?: number
          required?: boolean
          selection?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifier_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifier_links: {
        Row: {
          category_id: string | null
          created_at: string
          group_id: string
          id: string
          menu_item_id: string | null
          tenant_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          group_id: string
          id?: string
          menu_item_id?: string | null
          tenant_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          group_id?: string
          id?: string
          menu_item_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifier_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_modifier_links_group_fk"
            columns: ["group_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "menu_modifier_groups"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_modifier_links_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_modifier_links_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_modifier_links_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_modifier_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifier_options: {
        Row: {
          active: boolean
          created_at: string
          group_id: string
          id: string
          label: string
          position: number
          price_delta_cents: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_id: string
          id?: string
          label: string
          position?: number
          price_delta_cents?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          group_id?: string
          id?: string
          label?: string
          position?: number
          price_delta_cents?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifier_options_group_fk"
            columns: ["group_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "menu_modifier_groups"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_modifier_options_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_price_changes: {
        Row: {
          batch_id: string | null
          branch_id: string | null
          changed_by: string | null
          created_at: string
          id: string
          menu_item_id: string
          new_price_cents: number | null
          old_price_cents: number | null
          tenant_id: string
        }
        Insert: {
          batch_id?: string | null
          branch_id?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          menu_item_id: string
          new_price_cents?: number | null
          old_price_cents?: number | null
          tenant_id: string
        }
        Update: {
          batch_id?: string | null
          branch_id?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          menu_item_id?: string
          new_price_cents?: number | null
          old_price_cents?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_price_changes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_price_changes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_price_changes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_price_changes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_price_changes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_revisions: {
        Row: {
          changed_at: string
          forced_at: string | null
          forced_by: string | null
          rev: number
          tenant_id: string
        }
        Insert: {
          changed_at?: string
          forced_at?: string | null
          forced_by?: string | null
          rev?: number
          tenant_id: string
        }
        Update: {
          changed_at?: string
          forced_at?: string | null
          forced_by?: string | null
          rev?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_revisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_stockouts: {
        Row: {
          branch_id: string
          cleared_at: string | null
          created_at: string
          created_by: string | null
          menu_item_id: string
          service_day: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          cleared_at?: string | null
          created_at?: string
          created_by?: string | null
          menu_item_id: string
          service_day: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cleared_at?: string | null
          created_at?: string
          created_by?: string | null
          menu_item_id?: string
          service_day?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_stockouts_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_stockouts_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_stockouts_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_stockouts_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "menu_stockouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          category: string
          channel_id: string
          components: Json
          created_at: string
          id: string
          language: string
          last_synced_at: string | null
          meta_template_id: string | null
          name: string
          status: Database["public"]["Enums"]["template_status"]
          tenant_id: string
          variable_hints: Json
        }
        Insert: {
          category: string
          channel_id: string
          components?: Json
          created_at?: string
          id?: string
          language: string
          last_synced_at?: string | null
          meta_template_id?: string | null
          name: string
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id: string
          variable_hints?: Json
        }
        Update: {
          category?: string
          channel_id?: string
          components?: Json
          created_at?: string
          id?: string
          language?: string
          last_synced_at?: string | null
          meta_template_id?: string | null
          name?: string
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id?: string
          variable_hints?: Json
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          broadcast_id: string | null
          content: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          error: string | null
          flow_execution_id: string | null
          id: string
          media: Json | null
          meta_message_id: string | null
          read_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["message_status"] | null
          tenant_id: string
        }
        Insert: {
          broadcast_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          error?: string | null
          flow_execution_id?: string | null
          id?: string
          media?: Json | null
          meta_message_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
          tenant_id: string
        }
        Update: {
          broadcast_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["message_direction"]
          error?: string | null
          flow_execution_id?: string | null
          id?: string
          media?: Json | null
          meta_message_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_broadcast_fk"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_flow_execution_fk"
            columns: ["flow_execution_id"]
            isOneToOne: false
            referencedRelation: "flow_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_benefit_tiers: {
        Row: {
          benefit_id: string
          created_at: string
          tenant_id: string
          tier_id: string
        }
        Insert: {
          benefit_id: string
          created_at?: string
          tenant_id: string
          tier_id: string
        }
        Update: {
          benefit_id?: string
          created_at?: string
          tenant_id?: string
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_benefit_tiers_benefit_id_fkey"
            columns: ["benefit_id"]
            isOneToOne: false
            referencedRelation: "partner_benefits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_benefit_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_benefit_tiers_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_benefits: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          discount_pct: number | null
          id: string
          image_url: string | null
          label: string
          partner_id: string
          sort: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          id?: string
          image_url?: string | null
          label: string
          partner_id: string
          sort?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          id?: string
          image_url?: string | null
          label?: string
          partner_id?: string
          sort?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_benefits_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_benefits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          discount_label: string | null
          id: string
          logo_url: string | null
          name: string
          sort: number
          tenant_id: string
          updated_at: string
          url: string | null
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          discount_label?: string | null
          id?: string
          logo_url?: string | null
          name: string
          sort?: number
          tenant_id: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          discount_label?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          sort?: number
          tenant_id?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_tables: {
        Row: {
          active: boolean
          branch_id: string
          capacity: number | null
          created_at: string
          id: string
          label: string
          qr_token: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          capacity?: number | null
          created_at?: string
          id?: string
          label: string
          qr_token?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          capacity?: number | null
          created_at?: string
          id?: string
          label?: string
          qr_token?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "physical_tables_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "physical_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          email: string
          id: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      platform_meta_config: {
        Row: {
          app_id: string | null
          app_secret_encrypted: string | null
          id: boolean
          updated_at: string
          updated_by: string | null
          webhook_verify_token: string | null
        }
        Insert: {
          app_id?: string | null
          app_secret_encrypted?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          webhook_verify_token?: string | null
        }
        Update: {
          app_id?: string | null
          app_secret_encrypted?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          webhook_verify_token?: string | null
        }
        Relationships: []
      }
      points_rules: {
        Row: {
          active: boolean
          config: Json
          created_at: string
          id: string
          priority: number
          tenant_id: string
          type: Database["public"]["Enums"]["points_rule_type"]
        }
        Insert: {
          active?: boolean
          config: Json
          created_at?: string
          id?: string
          priority?: number
          tenant_id: string
          type: Database["public"]["Enums"]["points_rule_type"]
        }
        Update: {
          active?: boolean
          config?: Json
          created_at?: string
          id?: string
          priority?: number
          tenant_id?: string
          type?: Database["public"]["Enums"]["points_rule_type"]
        }
        Relationships: [
          {
            foreignKeyName: "points_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      points_transactions: {
        Row: {
          created_at: string
          customer_id: string
          delta: number
          id: string
          payload: Json
          reason: string
          redemption_id: string | null
          tenant_id: string
          visit_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          delta: number
          id?: string
          payload?: Json
          reason: string
          redemption_id?: string | null
          tenant_id: string
          visit_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          delta?: number
          id?: string
          payload?: Json
          reason?: string
          redemption_id?: string | null
          tenant_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "points_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "points_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "points_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "points_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_transactions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_tx_redemption_fk"
            columns: ["redemption_id"]
            isOneToOne: false
            referencedRelation: "reward_redemptions"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_approvals: {
        Row: {
          branch_id: string
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_note: string | null
          id: string
          kind: string
          payload: Json
          requested_at: string
          requested_by: string | null
          requested_by_name: string
          session_id: string
          status: string
          summary: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          id?: string
          kind: string
          payload?: Json
          requested_at?: string
          requested_by?: string | null
          requested_by_name: string
          session_id: string
          status?: string
          summary: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          id?: string
          kind?: string
          payload?: Json
          requested_at?: string
          requested_by?: string | null
          requested_by_name?: string
          session_id?: string
          status?: string
          summary?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_approvals_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_approvals_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_cash_movements: {
        Row: {
          acc_client_ref: string | null
          acc_dismissed_at: string | null
          acc_dismissed_by: string | null
          amount_cents: number
          branch_id: string
          created_at: string
          created_by: string | null
          created_by_name: string
          employee_id: string | null
          employee_name: string | null
          id: string
          idempotency_key: string | null
          kind: string
          party_id: string | null
          party_name: string | null
          period_from: string | null
          period_to: string | null
          photo_path: string | null
          purpose: string | null
          reason: string
          shift_id: string
          tenant_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_name: string | null
        }
        Insert: {
          acc_client_ref?: string | null
          acc_dismissed_at?: string | null
          acc_dismissed_by?: string | null
          amount_cents: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          created_by_name: string
          employee_id?: string | null
          employee_name?: string | null
          id?: string
          idempotency_key?: string | null
          kind: string
          party_id?: string | null
          party_name?: string | null
          period_from?: string | null
          period_to?: string | null
          photo_path?: string | null
          purpose?: string | null
          reason: string
          shift_id: string
          tenant_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Update: {
          acc_client_ref?: string | null
          acc_dismissed_at?: string | null
          acc_dismissed_by?: string | null
          amount_cents?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          employee_id?: string | null
          employee_name?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          party_id?: string | null
          party_name?: string | null
          period_from?: string | null
          period_to?: string | null
          photo_path?: string | null
          purpose?: string | null
          reason?: string
          shift_id?: string
          tenant_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_cash_movements_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_cash_movements_shift_fk"
            columns: ["shift_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pos_shifts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_closed_bills: {
        Row: {
          branch_id: string
          closed_at: string
          closed_by: string | null
          closed_by_name: string
          customer_id: string | null
          deposit_cents: number
          discount_cents: number
          due_cents: number
          is_practice: boolean
          party_size: number | null
          points_awarded: number
          points_failed: boolean
          reservation_id: string | null
          service_day: string
          session_id: string
          shift_id: string | null
          subtotal_cents: number
          tenant_id: string
          visit_id: string | null
        }
        Insert: {
          branch_id: string
          closed_at?: string
          closed_by?: string | null
          closed_by_name: string
          customer_id?: string | null
          deposit_cents: number
          discount_cents: number
          due_cents: number
          is_practice?: boolean
          party_size?: number | null
          points_awarded?: number
          points_failed?: boolean
          reservation_id?: string | null
          service_day: string
          session_id: string
          shift_id?: string | null
          subtotal_cents: number
          tenant_id: string
          visit_id?: string | null
        }
        Update: {
          branch_id?: string
          closed_at?: string
          closed_by?: string | null
          closed_by_name?: string
          customer_id?: string | null
          deposit_cents?: number
          discount_cents?: number
          due_cents?: number
          is_practice?: boolean
          party_size?: number | null
          points_awarded?: number
          points_failed?: boolean
          reservation_id?: string | null
          service_day?: string
          session_id?: string
          shift_id?: string | null
          subtotal_cents?: number
          tenant_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_closed_bills_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_closed_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_closed_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "pos_closed_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "pos_closed_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "pos_closed_bills_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "salon_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_closed_bills_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_closed_bills_shift_fk"
            columns: ["shift_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pos_shifts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_closed_bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_closed_bills_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_discounts: {
        Row: {
          approval_id: string | null
          approved_by_name: string | null
          branch_id: string
          created_at: string
          created_by: string | null
          created_by_name: string
          id: string
          kind: string
          reason: string
          removed_at: string | null
          removed_by: string | null
          removed_by_name: string | null
          session_id: string
          status: string
          tenant_id: string
          value: number
        }
        Insert: {
          approval_id?: string | null
          approved_by_name?: string | null
          branch_id: string
          created_at?: string
          created_by?: string | null
          created_by_name: string
          id?: string
          kind: string
          reason: string
          removed_at?: string | null
          removed_by?: string | null
          removed_by_name?: string | null
          session_id: string
          status?: string
          tenant_id: string
          value: number
        }
        Update: {
          approval_id?: string | null
          approved_by_name?: string | null
          branch_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          id?: string
          kind?: string
          reason?: string
          removed_at?: string | null
          removed_by?: string | null
          removed_by_name?: string | null
          session_id?: string
          status?: string
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_discounts_approval_fk"
            columns: ["approval_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pos_approvals"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_discounts_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_discounts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_discounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_payment_edits: {
        Row: {
          created_at: string
          edited_by: string | null
          edited_by_name: string
          field: string
          id: string
          new_value: string
          note: string | null
          old_value: string
          payment_id: string
          shift_closed: boolean
          tenant_id: string
        }
        Insert: {
          created_at?: string
          edited_by?: string | null
          edited_by_name: string
          field: string
          id?: string
          new_value: string
          note?: string | null
          old_value: string
          payment_id: string
          shift_closed?: boolean
          tenant_id: string
        }
        Update: {
          created_at?: string
          edited_by?: string | null
          edited_by_name?: string
          field?: string
          id?: string
          new_value?: string
          note?: string | null
          old_value?: string
          payment_id?: string
          shift_closed?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_payment_edits_payment_fk"
            columns: ["payment_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pos_payments"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_payment_edits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_payments: {
        Row: {
          amount_cents: number
          branch_id: string
          change_cents: number
          created_at: string
          created_by: string | null
          created_by_name: string
          id: string
          idempotency_key: string | null
          invoice: boolean
          is_practice: boolean
          item_ids: string[]
          method: string
          payer_label: string | null
          reference: string | null
          service_day: string
          session_id: string
          shift_id: string | null
          status: string
          surcharge_cents: number
          tenant_id: string
          tendered_cents: number | null
          tip_cents: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_name: string | null
        }
        Insert: {
          amount_cents: number
          branch_id: string
          change_cents?: number
          created_at?: string
          created_by?: string | null
          created_by_name: string
          id?: string
          idempotency_key?: string | null
          invoice: boolean
          is_practice?: boolean
          item_ids?: string[]
          method: string
          payer_label?: string | null
          reference?: string | null
          service_day: string
          session_id: string
          shift_id?: string | null
          status?: string
          surcharge_cents?: number
          tenant_id: string
          tendered_cents?: number | null
          tip_cents?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Update: {
          amount_cents?: number
          branch_id?: string
          change_cents?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          id?: string
          idempotency_key?: string | null
          invoice?: boolean
          is_practice?: boolean
          item_ids?: string[]
          method?: string
          payer_label?: string | null
          reference?: string | null
          service_day?: string
          session_id?: string
          shift_id?: string | null
          status?: string
          surcharge_cents?: number
          tenant_id?: string
          tendered_cents?: number | null
          tip_cents?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_payments_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payments_shift_fk"
            columns: ["shift_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pos_shifts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_registers: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          id: string
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          id?: string
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_registers_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_registers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_settings: {
        Row: {
          approver_roles: string[]
          bill_denominations: number[]
          bill_warn_minutes: number
          created_at: string
          credit_surcharge_bp: number
          discount_needs_approval: boolean
          invoice_by_method: Json
          kitchen_late_minutes: number
          kitchen_warn_minutes: number
          order_warn_minutes: number
          ready_warn_minutes: number
          tenant_id: string
          tip_presets_pct: number[]
          transfer_alias: string | null
          transfer_holder: string | null
          updated_at: string
          updated_by: string | null
          void_needs_approval: boolean
        }
        Insert: {
          approver_roles?: string[]
          bill_denominations?: number[]
          bill_warn_minutes?: number
          created_at?: string
          credit_surcharge_bp?: number
          discount_needs_approval?: boolean
          invoice_by_method?: Json
          kitchen_late_minutes?: number
          kitchen_warn_minutes?: number
          order_warn_minutes?: number
          ready_warn_minutes?: number
          tenant_id: string
          tip_presets_pct?: number[]
          transfer_alias?: string | null
          transfer_holder?: string | null
          updated_at?: string
          updated_by?: string | null
          void_needs_approval?: boolean
        }
        Update: {
          approver_roles?: string[]
          bill_denominations?: number[]
          bill_warn_minutes?: number
          created_at?: string
          credit_surcharge_bp?: number
          discount_needs_approval?: boolean
          invoice_by_method?: Json
          kitchen_late_minutes?: number
          kitchen_warn_minutes?: number
          order_warn_minutes?: number
          ready_warn_minutes?: number
          tenant_id?: string
          tip_presets_pct?: number[]
          transfer_alias?: string | null
          transfer_holder?: string | null
          updated_at?: string
          updated_by?: string | null
          void_needs_approval?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pos_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_shifts: {
        Row: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          closing_note: string | null
          count_breakdown: Json | null
          counted_cash_cents: number | null
          created_at: string
          difference_cents: number | null
          expected_cash_cents: number | null
          id: string
          is_practice: boolean
          label: string | null
          leave_float_cents: number | null
          opened_at: string
          opened_by: string | null
          opened_by_name: string
          opening_expected_cents: number | null
          opening_float_cents: number
          opening_note: string | null
          register_id: string
          service_day: string
          status: string
          summary: Json | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          closing_note?: string | null
          count_breakdown?: Json | null
          counted_cash_cents?: number | null
          created_at?: string
          difference_cents?: number | null
          expected_cash_cents?: number | null
          id?: string
          is_practice?: boolean
          label?: string | null
          leave_float_cents?: number | null
          opened_at?: string
          opened_by?: string | null
          opened_by_name: string
          opening_expected_cents?: number | null
          opening_float_cents: number
          opening_note?: string | null
          register_id: string
          service_day: string
          status?: string
          summary?: Json | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          closing_note?: string | null
          count_breakdown?: Json | null
          counted_cash_cents?: number | null
          created_at?: string
          difference_cents?: number | null
          expected_cash_cents?: number | null
          id?: string
          is_practice?: boolean
          label?: string | null
          leave_float_cents?: number | null
          opened_at?: string
          opened_by?: string | null
          opened_by_name?: string
          opening_expected_cents?: number | null
          opening_float_cents?: number
          opening_note?: string | null
          register_id?: string
          service_day?: string
          status?: string
          summary?: Json | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_shifts_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_shifts_register_fk"
            columns: ["register_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pos_registers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pos_shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      public_link_pages: {
        Row: {
          active: boolean
          bio: string | null
          created_at: string
          headline: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          bio?: string | null
          created_at?: string
          headline?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          bio?: string | null
          created_at?: string
          headline?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_link_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      public_links: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          highlight: boolean
          icon: string | null
          id: string
          label: string
          position: number
          tenant_id: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          highlight?: boolean
          icon?: string | null
          id?: string
          label: string
          position?: number
          tenant_id: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          highlight?: boolean
          icon?: string | null
          id?: string
          label?: string
          position?: number
          tenant_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_card_stamps: {
        Row: {
          card_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          qty: number
          source: string
          template_id: string
          tenant_id: string
          visit_id: string | null
        }
        Insert: {
          card_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          qty?: number
          source?: string
          template_id: string
          tenant_id: string
          visit_id?: string | null
        }
        Update: {
          card_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          qty?: number
          source?: string
          template_id?: string
          tenant_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "punch_card_stamps_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "customer_punch_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_card_stamps_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_card_stamps_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "punch_card_stamps_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "punch_card_stamps_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "punch_card_stamps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "punch_card_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_card_stamps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_card_stamps_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_card_template_tiers: {
        Row: {
          created_at: string
          template_id: string
          tenant_id: string
          tier_id: string
        }
        Insert: {
          created_at?: string
          template_id: string
          tenant_id: string
          tier_id: string
        }
        Update: {
          created_at?: string
          template_id?: string
          tenant_id?: string
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "punch_card_template_tiers_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "punch_card_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_card_template_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_card_template_tiers_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_card_templates: {
        Row: {
          active: boolean
          config: Json
          created_at: string
          description: string | null
          expires_after_days: number | null
          id: string
          image_url: string | null
          name: string
          reward_id: string
          reward_label: string | null
          show_when_locked: boolean
          sort: number
          stamp_icon: string | null
          tenant_id: string
          threshold: number
          trigger_ref_id: string | null
          trigger_type: Database["public"]["Enums"]["punch_trigger_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          config?: Json
          created_at?: string
          description?: string | null
          expires_after_days?: number | null
          id?: string
          image_url?: string | null
          name: string
          reward_id: string
          reward_label?: string | null
          show_when_locked?: boolean
          sort?: number
          stamp_icon?: string | null
          tenant_id: string
          threshold: number
          trigger_ref_id?: string | null
          trigger_type: Database["public"]["Enums"]["punch_trigger_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          config?: Json
          created_at?: string
          description?: string | null
          expires_after_days?: number | null
          id?: string
          image_url?: string | null
          name?: string
          reward_id?: string
          reward_label?: string | null
          show_when_locked?: boolean
          sort?: number
          stamp_icon?: string | null
          tenant_id?: string
          threshold?: number
          trigger_ref_id?: string | null
          trigger_type?: Database["public"]["Enums"]["punch_trigger_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "punch_card_templates_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_card_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_count_lines: {
        Row: {
          count_id: string
          created_at: string
          id: string
          item_id: string
          quantity: number | null
          state: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          count_id: string
          created_at?: string
          id?: string
          item_id: string
          quantity?: number | null
          state: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          count_id?: string
          created_at?: string
          id?: string
          item_id?: string
          quantity?: number | null
          state?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pur_count_lines_count_fk"
            columns: ["count_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_counts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_count_lines_item_fk"
            columns: ["item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_count_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_counts: {
        Row: {
          count_date: string
          counted_by_name: string
          created_at: string
          created_by: string | null
          events_until: string
          id: string
          kind: string
          sent_at: string | null
          sent_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          count_date: string
          counted_by_name: string
          created_at?: string
          created_by?: string | null
          events_until: string
          id?: string
          kind?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          count_date?: string
          counted_by_name?: string
          created_at?: string
          created_by?: string | null
          events_until?: string
          id?: string
          kind?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pur_counts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_event_plans: {
        Row: {
          created_at: string
          guests: number | null
          id: string
          recipe_id: string | null
          scheduled_event_id: string
          skip: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          guests?: number | null
          id?: string
          recipe_id?: string | null
          scheduled_event_id: string
          skip?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          guests?: number | null
          id?: string
          recipe_id?: string | null
          scheduled_event_id?: string
          skip?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pur_event_plans_event_fk"
            columns: ["scheduled_event_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "scheduled_events"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_event_plans_recipe_fk"
            columns: ["recipe_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_recipes"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_event_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_items: {
        Row: {
          active: boolean
          brand: string | null
          code: string | null
          created_at: string
          created_by: string | null
          frequency: string
          id: string
          name: string
          notes: string | null
          pack_label: string | null
          pack_size: number | null
          supplier_id: string | null
          target_qty: number | null
          tenant_id: string
          unit: string
          updated_at: string
          updated_by: string | null
          zone_id: string | null
        }
        Insert: {
          active?: boolean
          brand?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          name: string
          notes?: string | null
          pack_label?: string | null
          pack_size?: number | null
          supplier_id?: string | null
          target_qty?: number | null
          tenant_id: string
          unit: string
          updated_at?: string
          updated_by?: string | null
          zone_id?: string | null
        }
        Update: {
          active?: boolean
          brand?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          name?: string
          notes?: string | null
          pack_label?: string | null
          pack_size?: number | null
          supplier_id?: string | null
          target_qty?: number | null
          tenant_id?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pur_items_supplier_fk"
            columns: ["supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pur_items_zone_fk"
            columns: ["zone_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_zones"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      pur_order_lines: {
        Row: {
          added_by_hand: boolean
          confirmed_packs: number | null
          count_state: string | null
          counted_qty: number | null
          created_at: string
          event_names: string[]
          event_qty: number
          id: string
          in_transit_qty: number
          item_id: string | null
          name: string
          order_id: string
          ordered_packs: number | null
          pack_label: string | null
          pack_size: number | null
          received_packs: number | null
          received_state: string | null
          sort_order: number
          suggested_packs: number | null
          target_qty: number | null
          tenant_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          added_by_hand?: boolean
          confirmed_packs?: number | null
          count_state?: string | null
          counted_qty?: number | null
          created_at?: string
          event_names?: string[]
          event_qty?: number
          id?: string
          in_transit_qty?: number
          item_id?: string | null
          name: string
          order_id: string
          ordered_packs?: number | null
          pack_label?: string | null
          pack_size?: number | null
          received_packs?: number | null
          received_state?: string | null
          sort_order?: number
          suggested_packs?: number | null
          target_qty?: number | null
          tenant_id: string
          unit: string
          updated_at?: string
        }
        Update: {
          added_by_hand?: boolean
          confirmed_packs?: number | null
          count_state?: string | null
          counted_qty?: number | null
          created_at?: string
          event_names?: string[]
          event_qty?: number
          id?: string
          in_transit_qty?: number
          item_id?: string | null
          name?: string
          order_id?: string
          ordered_packs?: number | null
          pack_label?: string | null
          pack_size?: number | null
          received_packs?: number | null
          received_state?: string | null
          sort_order?: number
          suggested_packs?: number | null
          target_qty?: number | null
          tenant_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pur_order_lines_item_fk"
            columns: ["item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_order_lines_order_fk"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_order_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_orders: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_with_changes: boolean
          count_id: string | null
          created_at: string
          created_by: string | null
          discard_reason: string | null
          discarded_at: string | null
          discarded_by: string | null
          expected_date: string | null
          id: string
          kitchen_note: string | null
          message: string | null
          received_at: string | null
          received_by: string | null
          received_by_name: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          supplier_id: string | null
          supplier_note: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_with_changes?: boolean
          count_id?: string | null
          created_at?: string
          created_by?: string | null
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          expected_date?: string | null
          id?: string
          kitchen_note?: string | null
          message?: string | null
          received_at?: string | null
          received_by?: string | null
          received_by_name?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          supplier_id?: string | null
          supplier_note?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_with_changes?: boolean
          count_id?: string | null
          created_at?: string
          created_by?: string | null
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          expected_date?: string | null
          id?: string
          kitchen_note?: string | null
          message?: string | null
          received_at?: string | null
          received_by?: string | null
          received_by_name?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          supplier_id?: string | null
          supplier_note?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pur_orders_count_fk"
            columns: ["count_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_counts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_orders_supplier_fk"
            columns: ["supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_recipe_lines: {
        Row: {
          created_at: string
          id: string
          in_house: boolean
          item_id: string | null
          name: string
          note: string | null
          quantity: number | null
          recipe_id: string
          sort_order: number
          tenant_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          in_house?: boolean
          item_id?: string | null
          name: string
          note?: string | null
          quantity?: number | null
          recipe_id: string
          sort_order?: number
          tenant_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          in_house?: boolean
          item_id?: string | null
          name?: string
          note?: string | null
          quantity?: number | null
          recipe_id?: string
          sort_order?: number
          tenant_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pur_recipe_lines_item_fk"
            columns: ["item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_recipe_lines_recipe_fk"
            columns: ["recipe_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_recipes"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_recipe_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_recipes: {
        Row: {
          active: boolean
          base_guests: number
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          template_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          variant: string
        }
        Insert: {
          active?: boolean
          base_guests?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          template_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          variant?: string
        }
        Update: {
          active?: boolean
          base_guests?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          template_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "pur_recipes_template_fk"
            columns: ["template_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "scheduled_event_templates"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_recipes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_settings: {
        Row: {
          arrive_days_before: number
          count_weekdays: number[]
          count_windows: Json
          created_at: string
          low_fraction: number
          recipe_base_guests: number
          reviewer_name: string | null
          sender_name: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          arrive_days_before?: number
          count_weekdays?: number[]
          count_windows?: Json
          created_at?: string
          low_fraction?: number
          recipe_base_guests?: number
          reviewer_name?: string | null
          sender_name?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          arrive_days_before?: number
          count_weekdays?: number[]
          count_windows?: Json
          created_at?: string
          low_fraction?: number
          recipe_base_guests?: number
          reviewer_name?: string | null
          sender_name?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pur_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_supplier_parties: {
        Row: {
          acc_party_id: string
          created_at: string
          created_by: string | null
          id: string
          supplier_id: string
          tenant_id: string
        }
        Insert: {
          acc_party_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          supplier_id: string
          tenant_id: string
        }
        Update: {
          acc_party_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          supplier_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pur_supplier_parties_party_fk"
            columns: ["acc_party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_supplier_parties_supplier_fk"
            columns: ["supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "pur_suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_supplier_parties_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_suppliers: {
        Row: {
          acc_party_id: string | null
          active: boolean
          contact_name: string | null
          created_at: string
          created_by: string | null
          delivery_weekdays: number[]
          id: string
          lead_days: number
          name: string
          notes: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          whatsapp: string | null
        }
        Insert: {
          acc_party_id?: string | null
          active?: boolean
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          delivery_weekdays?: number[]
          id?: string
          lead_days?: number
          name: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Update: {
          acc_party_id?: string | null
          active?: boolean
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          delivery_weekdays?: number[]
          id?: string
          lead_days?: number
          name?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pur_suppliers_party_fk"
            columns: ["acc_party_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "acc_parties"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "pur_suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pur_zones: {
        Row: {
          active: boolean
          area: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          area?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          area?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pur_zones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_messages: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          shortcut: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          shortcut: string
          sort_order?: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          shortcut?: string
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_managers: {
        Row: {
          active: boolean
          commission_eligible: boolean
          created_at: string
          display_name: string
          email: string | null
          id: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          commission_eligible?: boolean
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          commission_eligible?: boolean
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_managers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          customer_id: string | null
          id: string
          rating: number
          redirected_to_maps: boolean
          source: string
          tenant_id: string
          visit_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          rating: number
          redirected_to_maps?: boolean
          source?: string
          tenant_id: string
          visit_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          rating?: number
          redirected_to_maps?: boolean
          source?: string
          tenant_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_redemptions: {
        Row: {
          created_at: string
          customer_id: string
          delivered_at: string | null
          delivered_by: string | null
          id: string
          notes: string | null
          points_spent: number
          redeem_token: string | null
          redeemed_at: string
          redeemed_by: string | null
          reward_id: string
          source: string
          status: Database["public"]["Enums"]["redemption_status"]
          tenant_id: string
          token_expires_at: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          delivered_by?: string | null
          id?: string
          notes?: string | null
          points_spent: number
          redeem_token?: string | null
          redeemed_at?: string
          redeemed_by?: string | null
          reward_id: string
          source?: string
          status?: Database["public"]["Enums"]["redemption_status"]
          tenant_id: string
          token_expires_at?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          delivered_by?: string | null
          id?: string
          notes?: string | null
          points_spent?: number
          redeem_token?: string | null
          redeemed_at?: string
          redeemed_by?: string | null
          reward_id?: string
          source?: string
          status?: Database["public"]["Enums"]["redemption_status"]
          tenant_id?: string
          token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reward_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reward_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards: {
        Row: {
          active: boolean
          category: string | null
          cost_points: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          min_tier_id: string | null
          name: string
          sort: number
          stock: number | null
          tenant_id: string
          visible_in_catalog: boolean
        }
        Insert: {
          active?: boolean
          category?: string | null
          cost_points: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          min_tier_id?: string | null
          name: string
          sort?: number
          stock?: number | null
          tenant_id: string
          visible_in_catalog?: boolean
        }
        Update: {
          active?: boolean
          category?: string | null
          cost_points?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          min_tier_id?: string | null
          name?: string
          sort?: number
          stock?: number | null
          tenant_id?: string
          visible_in_catalog?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rewards_min_tier_id_fkey"
            columns: ["min_tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rewards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_reservations: {
        Row: {
          actual_guests: number | null
          arrived_at: string | null
          arrived_by: string | null
          assistant_manager_id: string | null
          branch_id: string
          cake_count: number
          cake_option_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          champagne_count: number
          closed_at: string | null
          closed_by: string | null
          comments: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deposit_cents: number
          deposit_method: string | null
          estimated_guests: number
          guest_email: string | null
          guest_instagram: string | null
          guest_name: string
          guest_phone: string | null
          highlight_comment: boolean
          id: string
          kind: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_end_time_local: string | null
          reservation_time_local: string
          scheduled_event_id: string | null
          seated_at: string | null
          seated_by: string | null
          service_alerts: Database["public"]["Enums"]["service_alert"][]
          status: Database["public"]["Enums"]["salon_reservation_status"]
          table_label: string | null
          tenant_id: string
          updated_at: string
          zone: Database["public"]["Enums"]["salon_zone"] | null
        }
        Insert: {
          actual_guests?: number | null
          arrived_at?: string | null
          arrived_by?: string | null
          assistant_manager_id?: string | null
          branch_id: string
          cake_count?: number
          cake_option_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          champagne_count?: number
          closed_at?: string | null
          closed_by?: string | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deposit_cents?: number
          deposit_method?: string | null
          estimated_guests: number
          guest_email?: string | null
          guest_instagram?: string | null
          guest_name: string
          guest_phone?: string | null
          highlight_comment?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin?: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_end_time_local?: string | null
          reservation_time_local: string
          scheduled_event_id?: string | null
          seated_at?: string | null
          seated_by?: string | null
          service_alerts?: Database["public"]["Enums"]["service_alert"][]
          status?: Database["public"]["Enums"]["salon_reservation_status"]
          table_label?: string | null
          tenant_id: string
          updated_at?: string
          zone?: Database["public"]["Enums"]["salon_zone"] | null
        }
        Update: {
          actual_guests?: number | null
          arrived_at?: string | null
          arrived_by?: string | null
          assistant_manager_id?: string | null
          branch_id?: string
          cake_count?: number
          cake_option_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          champagne_count?: number
          closed_at?: string | null
          closed_by?: string | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deposit_cents?: number
          deposit_method?: string | null
          estimated_guests?: number
          guest_email?: string | null
          guest_instagram?: string | null
          guest_name?: string
          guest_phone?: string | null
          highlight_comment?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["reservation_kind"]
          meal_type?: Database["public"]["Enums"]["meal_type"]
          origin?: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id?: string
          reservation_date?: string
          reservation_end_time_local?: string | null
          reservation_time_local?: string
          scheduled_event_id?: string | null
          seated_at?: string | null
          seated_by?: string | null
          service_alerts?: Database["public"]["Enums"]["service_alert"][]
          status?: Database["public"]["Enums"]["salon_reservation_status"]
          table_label?: string | null
          tenant_id?: string
          updated_at?: string
          zone?: Database["public"]["Enums"]["salon_zone"] | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_reservations_assistant_manager_id_fkey"
            columns: ["assistant_manager_id"]
            isOneToOne: false
            referencedRelation: "reservation_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_reservations_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "salon_reservations_cake_option_id_fkey"
            columns: ["cake_option_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "cake_options"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "salon_reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "salon_reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "salon_reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "salon_reservations_primary_manager_id_fkey"
            columns: ["primary_manager_id"]
            isOneToOne: false
            referencedRelation: "reservation_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_reservations_scheduled_event_id_fkey"
            columns: ["scheduled_event_id"]
            isOneToOne: false
            referencedRelation: "scheduled_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_segment_capacities: {
        Row: {
          branch_id: string
          capacity: number
          created_at: string
          id: string
          iso_dow: number
          segment: Database["public"]["Enums"]["meal_type"]
          tenant_id: string
          updated_at: string
          warn_at: number | null
        }
        Insert: {
          branch_id: string
          capacity: number
          created_at?: string
          id?: string
          iso_dow: number
          segment: Database["public"]["Enums"]["meal_type"]
          tenant_id: string
          updated_at?: string
          warn_at?: number | null
        }
        Update: {
          branch_id?: string
          capacity?: number
          created_at?: string
          id?: string
          iso_dow?: number
          segment?: Database["public"]["Enums"]["meal_type"]
          tenant_id?: string
          updated_at?: string
          warn_at?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_segment_capacities_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "salon_segment_capacities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_segment_capacity_overrides: {
        Row: {
          branch_id: string
          capacity: number
          created_at: string
          id: string
          override_date: string
          reason: string | null
          segment: Database["public"]["Enums"]["meal_type"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          warn_at: number | null
        }
        Insert: {
          branch_id: string
          capacity: number
          created_at?: string
          id?: string
          override_date: string
          reason?: string | null
          segment: Database["public"]["Enums"]["meal_type"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          warn_at?: number | null
        }
        Update: {
          branch_id?: string
          capacity?: number
          created_at?: string
          id?: string
          override_date?: string
          reason?: string | null
          segment?: Database["public"]["Enums"]["meal_type"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          warn_at?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_segment_capacity_overrides_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "salon_segment_capacity_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_segment_settings: {
        Row: {
          branch_id: string
          created_at: string
          default_time: string
          id: string
          segment: Database["public"]["Enums"]["meal_type"]
          tenant_id: string
          updated_at: string
          warn_note: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          default_time: string
          id?: string
          segment: Database["public"]["Enums"]["meal_type"]
          tenant_id: string
          updated_at?: string
          warn_note?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          default_time?: string
          id?: string
          segment?: Database["public"]["Enums"]["meal_type"]
          tenant_id?: string
          updated_at?: string
          warn_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_segment_settings_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "salon_segment_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_zone_capacity_overrides: {
        Row: {
          capacity: number
          created_at: string
          id: string
          override_date: string
          reason: string | null
          tenant_id: string
          zone: Database["public"]["Enums"]["salon_zone"]
        }
        Insert: {
          capacity: number
          created_at?: string
          id?: string
          override_date: string
          reason?: string | null
          tenant_id: string
          zone: Database["public"]["Enums"]["salon_zone"]
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          override_date?: string
          reason?: string | null
          tenant_id?: string
          zone?: Database["public"]["Enums"]["salon_zone"]
        }
        Relationships: [
          {
            foreignKeyName: "salon_zone_capacity_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_event_marketing: {
        Row: {
          ad_spend_usd_cents: number
          cost_per_guest_ars_cents: number | null
          created_at: string
          created_by: string | null
          drink_cost_per_guest_ars_cents: number | null
          drink_revenue_per_guest_ars_cents: number | null
          id: string
          messages: number | null
          notes: string | null
          reach: number | null
          revenue_ars_cents: number | null
          revenue_per_guest_ars_cents: number | null
          scheduled_event_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          usd_ars_rate: number | null
        }
        Insert: {
          ad_spend_usd_cents: number
          cost_per_guest_ars_cents?: number | null
          created_at?: string
          created_by?: string | null
          drink_cost_per_guest_ars_cents?: number | null
          drink_revenue_per_guest_ars_cents?: number | null
          id?: string
          messages?: number | null
          notes?: string | null
          reach?: number | null
          revenue_ars_cents?: number | null
          revenue_per_guest_ars_cents?: number | null
          scheduled_event_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          usd_ars_rate?: number | null
        }
        Update: {
          ad_spend_usd_cents?: number
          cost_per_guest_ars_cents?: number | null
          created_at?: string
          created_by?: string | null
          drink_cost_per_guest_ars_cents?: number | null
          drink_revenue_per_guest_ars_cents?: number | null
          id?: string
          messages?: number | null
          notes?: string | null
          reach?: number | null
          revenue_ars_cents?: number | null
          revenue_per_guest_ars_cents?: number | null
          scheduled_event_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          usd_ars_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_event_marketing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sem_event_same_tenant"
            columns: ["scheduled_event_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "scheduled_events"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      scheduled_event_templates: {
        Row: {
          active: boolean
          color_hex: string
          consume_special_reservations: boolean
          created_at: string
          default_capacity: number | null
          default_meal_type: Database["public"]["Enums"]["meal_type"]
          default_private_group: boolean
          id: string
          name: string
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color_hex?: string
          consume_special_reservations?: boolean
          created_at?: string
          default_capacity?: number | null
          default_meal_type?: Database["public"]["Enums"]["meal_type"]
          default_private_group?: boolean
          id?: string
          name: string
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color_hex?: string
          consume_special_reservations?: boolean
          created_at?: string
          default_capacity?: number | null
          default_meal_type?: Database["public"]["Enums"]["meal_type"]
          default_private_group?: boolean
          id?: string
          name?: string
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_event_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_events: {
        Row: {
          attendance_points: number
          branch_id: string
          capacity: number
          created_at: string
          ends_at_local: string | null
          event_date: string
          full_bonus_active: boolean
          id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          name_override: string | null
          notes: string | null
          private_group: boolean
          starts_at_local: string
          template_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendance_points?: number
          branch_id: string
          capacity: number
          created_at?: string
          ends_at_local?: string | null
          event_date: string
          full_bonus_active?: boolean
          id?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          name_override?: string | null
          notes?: string | null
          private_group?: boolean
          starts_at_local: string
          template_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attendance_points?: number
          branch_id?: string
          capacity?: number
          created_at?: string
          ends_at_local?: string | null
          event_date?: string
          full_bonus_active?: boolean
          id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          name_override?: string | null
          notes?: string | null
          private_group?: boolean
          starts_at_local?: string
          template_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_events_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "scheduled_events_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "scheduled_event_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      session_guests: {
        Row: {
          browser_token: string
          created_at: string
          customer_id: string | null
          display_name: string | null
          id: string
          joined_at: string
          last_activity_at: string
          session_id: string
        }
        Insert: {
          browser_token: string
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          id?: string
          joined_at?: string
          last_activity_at?: string
          session_id: string
        }
        Update: {
          browser_token?: string
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          id?: string
          joined_at?: string
          last_activity_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_guests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_guests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "session_guests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "session_guests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "session_guests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      table_session_events: {
        Row: {
          created_at: string
          created_by_guest_id: string | null
          created_by_user_id: string | null
          id: string
          payload: Json
          session_id: string
          type: Database["public"]["Enums"]["session_event_type"]
        }
        Insert: {
          created_at?: string
          created_by_guest_id?: string | null
          created_by_user_id?: string | null
          id?: string
          payload?: Json
          session_id: string
          type: Database["public"]["Enums"]["session_event_type"]
        }
        Update: {
          created_at?: string
          created_by_guest_id?: string | null
          created_by_user_id?: string | null
          id?: string
          payload?: Json
          session_id?: string
          type?: Database["public"]["Enums"]["session_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "table_session_events_created_by_guest_id_fkey"
            columns: ["created_by_guest_id"]
            isOneToOne: false
            referencedRelation: "session_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          abandoned_reason: string | null
          alias: string | null
          bill_requested_at: string | null
          branch_id: string
          created_at: string
          customer_id: string | null
          id: string
          is_practice: boolean
          kind: string
          merged_into: string | null
          note: string | null
          opened_at: string
          opened_by: string | null
          paid_at: string | null
          party_size: number | null
          physical_table_id: string | null
          points_redeemed_cents: number
          points_redemptions: Json
          reservation_id: string | null
          service_day: string | null
          status: Database["public"]["Enums"]["session_status"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          abandoned_reason?: string | null
          alias?: string | null
          bill_requested_at?: string | null
          branch_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_practice?: boolean
          kind?: string
          merged_into?: string | null
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          paid_at?: string | null
          party_size?: number | null
          physical_table_id?: string | null
          points_redeemed_cents?: number
          points_redemptions?: Json
          reservation_id?: string | null
          service_day?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          abandoned_reason?: string | null
          alias?: string | null
          bill_requested_at?: string | null
          branch_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_practice?: boolean
          kind?: string
          merged_into?: string | null
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          paid_at?: string | null
          party_size?: number | null
          physical_table_id?: string | null
          points_redeemed_cents?: number
          points_redemptions?: Json
          reservation_id?: string | null
          service_day?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "table_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "table_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "table_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "table_sessions_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_physical_table_id_fkey"
            columns: ["physical_table_id"]
            isOneToOne: false
            referencedRelation: "physical_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "salon_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          brand_accent: string | null
          category_window_months: number
          created_at: string
          currency: string
          default_event_attendance_points: number
          feature_flags: Json
          feedback_whatsapp_phone: string | null
          google_maps_review_url: string | null
          guest_idle_hours_to_rescan: number
          id: string
          kitchen_flow_enabled: boolean
          logo_url: string | null
          name: string
          points_redemption_enabled: boolean
          points_redemption_max_pct: number
          points_to_cents_rate: number
          review_gating_enabled: boolean
          review_reward_points: number
          session_auto_abandon_hours: number
          settings: Json
          slug: string
          ticket_auto_accept_enabled: boolean
          ticket_auto_accept_max_cents: number | null
          ticket_auto_accept_max_items: number | null
          timezone: string
          total_seats: number | null
          updated_at: string
        }
        Insert: {
          brand_accent?: string | null
          category_window_months?: number
          created_at?: string
          currency?: string
          default_event_attendance_points?: number
          feature_flags?: Json
          feedback_whatsapp_phone?: string | null
          google_maps_review_url?: string | null
          guest_idle_hours_to_rescan?: number
          id?: string
          kitchen_flow_enabled?: boolean
          logo_url?: string | null
          name: string
          points_redemption_enabled?: boolean
          points_redemption_max_pct?: number
          points_to_cents_rate?: number
          review_gating_enabled?: boolean
          review_reward_points?: number
          session_auto_abandon_hours?: number
          settings?: Json
          slug: string
          ticket_auto_accept_enabled?: boolean
          ticket_auto_accept_max_cents?: number | null
          ticket_auto_accept_max_items?: number | null
          timezone?: string
          total_seats?: number | null
          updated_at?: string
        }
        Update: {
          brand_accent?: string | null
          category_window_months?: number
          created_at?: string
          currency?: string
          default_event_attendance_points?: number
          feature_flags?: Json
          feedback_whatsapp_phone?: string | null
          google_maps_review_url?: string | null
          guest_idle_hours_to_rescan?: number
          id?: string
          kitchen_flow_enabled?: boolean
          logo_url?: string | null
          name?: string
          points_redemption_enabled?: boolean
          points_redemption_max_pct?: number
          points_to_cents_rate?: number
          review_gating_enabled?: boolean
          review_reward_points?: number
          session_auto_abandon_hours?: number
          settings?: Json
          slug?: string
          ticket_auto_accept_enabled?: boolean
          ticket_auto_accept_max_cents?: number | null
          ticket_auto_accept_max_items?: number | null
          timezone?: string
          total_seats?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ticket_items: {
        Row: {
          assigned_to_guest_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          id: string
          line_total_cents: number
          menu_item_id: string
          modifiers: Json
          notes: string | null
          prep_status: string
          quantity: number
          ready_at: string | null
          served_at: string | null
          started_at: string | null
          station_id: string | null
          ticket_id: string
          unit_price_cents: number
        }
        Insert: {
          assigned_to_guest_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          line_total_cents: number
          menu_item_id: string
          modifiers?: Json
          notes?: string | null
          prep_status?: string
          quantity: number
          ready_at?: string | null
          served_at?: string | null
          started_at?: string | null
          station_id?: string | null
          ticket_id: string
          unit_price_cents: number
        }
        Update: {
          assigned_to_guest_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          line_total_cents?: number
          menu_item_id?: string
          modifiers?: Json
          notes?: string | null
          prep_status?: string
          quantity?: number
          ready_at?: string | null
          served_at?: string | null
          started_at?: string | null
          station_id?: string | null
          ticket_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_items_assigned_to_guest_id_fkey"
            columns: ["assigned_to_guest_id"]
            isOneToOne: false
            referencedRelation: "session_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "ticket_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "ticket_items_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_orders: {
        Row: {
          attention: string | null
          balance_cash_only: boolean
          branch_id: string
          client_ip: string | null
          created_at: string
          customer_id: string | null
          event_date: string
          event_time: string
          experience_id: string | null
          full_price_cents: number
          guest_name: string
          guest_phone: string
          hold_expires_at: string
          id: string
          marketing_opt_in: boolean
          meal_type: Database["public"]["Enums"]["meal_type"]
          mp_payment_id: string | null
          mp_payment_type: string | null
          mp_preference_id: string | null
          mp_status: string | null
          mp_status_detail: string | null
          paid_at: string | null
          paid_cents: number | null
          party_size: number
          payment_option: string
          reservation_id: string | null
          scheduled_event_id: string | null
          status: string
          tenant_id: string
          terms: string | null
          title: string
          total_cents: number
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          attention?: string | null
          balance_cash_only?: boolean
          branch_id: string
          client_ip?: string | null
          created_at?: string
          customer_id?: string | null
          event_date: string
          event_time: string
          experience_id?: string | null
          full_price_cents: number
          guest_name: string
          guest_phone: string
          hold_expires_at: string
          id?: string
          marketing_opt_in?: boolean
          meal_type: Database["public"]["Enums"]["meal_type"]
          mp_payment_id?: string | null
          mp_payment_type?: string | null
          mp_preference_id?: string | null
          mp_status?: string | null
          mp_status_detail?: string | null
          paid_at?: string | null
          paid_cents?: number | null
          party_size: number
          payment_option: string
          reservation_id?: string | null
          scheduled_event_id?: string | null
          status?: string
          tenant_id: string
          terms?: string | null
          title: string
          total_cents: number
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          attention?: string | null
          balance_cash_only?: boolean
          branch_id?: string
          client_ip?: string | null
          created_at?: string
          customer_id?: string | null
          event_date?: string
          event_time?: string
          experience_id?: string | null
          full_price_cents?: number
          guest_name?: string
          guest_phone?: string
          hold_expires_at?: string
          id?: string
          marketing_opt_in?: boolean
          meal_type?: Database["public"]["Enums"]["meal_type"]
          mp_payment_id?: string | null
          mp_payment_type?: string | null
          mp_preference_id?: string | null
          mp_status?: string | null
          mp_status_detail?: string | null
          paid_at?: string | null
          paid_cents?: number | null
          party_size?: number
          payment_option?: string
          reservation_id?: string | null
          scheduled_event_id?: string | null
          status?: string
          tenant_id?: string
          terms?: string | null
          title?: string
          total_cents?: number
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_orders_branch_fk"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ticket_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ticket_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ticket_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ticket_orders_event_same_tenant"
            columns: ["scheduled_event_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "scheduled_events"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ticket_orders_experience_same_tenant"
            columns: ["experience_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "event_experiences"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ticket_orders_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "salon_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ticketing_settings: {
        Row: {
          contact_whatsapp: string | null
          created_at: string
          headline: string | null
          hold_minutes: number
          intro: string | null
          mp_access_token_enc: string | null
          mp_connected_at: string | null
          mp_connected_by: string | null
          mp_live: boolean | null
          mp_nickname: string | null
          mp_user_id: number | null
          mp_webhook_secret_enc: string | null
          online_manager_id: string | null
          tenant_id: string
          transfer_alias: string | null
          transfer_holder: string | null
          updated_at: string
          updated_by: string | null
          venue_address: string | null
        }
        Insert: {
          contact_whatsapp?: string | null
          created_at?: string
          headline?: string | null
          hold_minutes?: number
          intro?: string | null
          mp_access_token_enc?: string | null
          mp_connected_at?: string | null
          mp_connected_by?: string | null
          mp_live?: boolean | null
          mp_nickname?: string | null
          mp_user_id?: number | null
          mp_webhook_secret_enc?: string | null
          online_manager_id?: string | null
          tenant_id: string
          transfer_alias?: string | null
          transfer_holder?: string | null
          updated_at?: string
          updated_by?: string | null
          venue_address?: string | null
        }
        Update: {
          contact_whatsapp?: string | null
          created_at?: string
          headline?: string | null
          hold_minutes?: number
          intro?: string | null
          mp_access_token_enc?: string | null
          mp_connected_at?: string | null
          mp_connected_by?: string | null
          mp_live?: boolean | null
          mp_nickname?: string | null
          mp_user_id?: number | null
          mp_webhook_secret_enc?: string | null
          online_manager_id?: string | null
          tenant_id?: string
          transfer_alias?: string | null
          transfer_holder?: string | null
          updated_at?: string
          updated_by?: string | null
          venue_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticketing_settings_manager_same_tenant"
            columns: ["online_manager_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "reservation_managers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "ticketing_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          course: number
          created_at: string
          created_by_guest_id: string | null
          created_by_user_id: string | null
          fired_at: string | null
          held: boolean
          id: string
          idempotency_key: string | null
          is_practice: boolean
          kitchen_seen_at: string | null
          prepared_at: string | null
          ready_at: string | null
          served_at: string | null
          session_id: string
          status: Database["public"]["Enums"]["ticket_status"]
          submitted_at: string
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          course?: number
          created_at?: string
          created_by_guest_id?: string | null
          created_by_user_id?: string | null
          fired_at?: string | null
          held?: boolean
          id?: string
          idempotency_key?: string | null
          is_practice?: boolean
          kitchen_seen_at?: string | null
          prepared_at?: string | null
          ready_at?: string | null
          served_at?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["ticket_status"]
          submitted_at?: string
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          course?: number
          created_at?: string
          created_by_guest_id?: string | null
          created_by_user_id?: string | null
          fired_at?: string | null
          held?: boolean
          id?: string
          idempotency_key?: string | null
          is_practice?: boolean
          kitchen_seen_at?: string | null
          prepared_at?: string | null
          ready_at?: string | null
          served_at?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["ticket_status"]
          submitted_at?: string
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_created_by_guest_id_fkey"
            columns: ["created_by_guest_id"]
            isOneToOne: false
            referencedRelation: "session_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_benefit_grants: {
        Row: {
          customer_id: string
          granted_at: string
          id: string
          period_key: string
          redemption_id: string | null
          reward_id: string | null
          tenant_id: string
          tier_benefit_id: string | null
          tier_id: string
        }
        Insert: {
          customer_id: string
          granted_at?: string
          id?: string
          period_key: string
          redemption_id?: string | null
          reward_id?: string | null
          tenant_id: string
          tier_benefit_id?: string | null
          tier_id: string
        }
        Update: {
          customer_id?: string
          granted_at?: string
          id?: string
          period_key?: string
          redemption_id?: string | null
          reward_id?: string | null
          tenant_id?: string
          tier_benefit_id?: string | null
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_benefit_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_redemption_id_fkey"
            columns: ["redemption_id"]
            isOneToOne: false
            referencedRelation: "reward_redemptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_tier_benefit_id_fkey"
            columns: ["tier_benefit_id"]
            isOneToOne: false
            referencedRelation: "tier_benefits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefit_grants_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_benefits: {
        Row: {
          active: boolean
          cadence: Database["public"]["Enums"]["tier_benefit_cadence"]
          created_at: string
          description: string | null
          discount_pct: number | null
          discount_scope: string | null
          icon: string | null
          id: string
          image_url: string | null
          kind: string
          label: string
          partner_id: string | null
          quantity: number
          reward_id: string | null
          sort: number
          tenant_id: string
          tier_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cadence?: Database["public"]["Enums"]["tier_benefit_cadence"]
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          discount_scope?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          kind: string
          label: string
          partner_id?: string | null
          quantity?: number
          reward_id?: string | null
          sort?: number
          tenant_id: string
          tier_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cadence?: Database["public"]["Enums"]["tier_benefit_cadence"]
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          discount_scope?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          label?: string
          partner_id?: string | null
          quantity?: number
          reward_id?: string | null
          sort?: number
          tenant_id?: string
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_benefits_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefits_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_benefits_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_active_tenant: {
        Row: {
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_tenant_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_items: {
        Row: {
          created_at: string
          id: string
          line_total_cents: number
          menu_item_id: string
          quantity: number
          unit_price_cents: number
          visit_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_total_cents: number
          menu_item_id: string
          quantity: number
          unit_price_cents: number
          visit_id: string
        }
        Update: {
          created_at?: string
          id?: string
          line_total_cents?: number
          menu_item_id?: string
          quantity?: number
          unit_price_cents?: number
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "visit_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["favorite_item_id"]
          },
          {
            foreignKeyName: "visit_items_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          notes: string | null
          source: Database["public"]["Enums"]["visit_source"]
          tenant_id: string
          total_amount_cents: number
          visited_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          notes?: string | null
          source?: Database["public"]["Enums"]["visit_source"]
          tenant_id: string
          total_amount_cents?: number
          visited_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          notes?: string | null
          source?: Database["public"]["Enums"]["visit_source"]
          tenant_id?: string
          total_amount_cents?: number
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "visits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "visits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "visits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      welcome_reward_configs: {
        Row: {
          bonus_points: number
          enabled: boolean
          headline: string
          reward_id: string | null
          subtext: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bonus_points?: number
          enabled?: boolean
          headline?: string
          reward_id?: string | null
          subtext?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bonus_points?: number
          enabled?: boolean
          headline?: string
          reward_id?: string | null
          subtext?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "welcome_reward_configs_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welcome_reward_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      welcome_reward_grants: {
        Row: {
          customer_id: string
          granted_at: string
          id: string
          redemption_id: string
          reward_id: string
          tenant_id: string
        }
        Insert: {
          customer_id: string
          granted_at?: string
          id?: string
          redemption_id: string
          reward_id: string
          tenant_id: string
        }
        Update: {
          customer_id?: string
          granted_at?: string
          id?: string
          redemption_id?: string
          reward_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "welcome_reward_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welcome_reward_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "welcome_reward_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "welcome_reward_grants_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "welcome_reward_grants_redemption_id_fkey"
            columns: ["redemption_id"]
            isOneToOne: false
            referencedRelation: "reward_redemptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welcome_reward_grants_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welcome_reward_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      mv_customer_stats: {
        Row: {
          avg_ticket_cents: number | null
          customer_id: string | null
          days_since_last_visit: number | null
          favorite_category_id: string | null
          favorite_category_name: string | null
          favorite_item_id: string | null
          favorite_item_name: string | null
          first_name: string | null
          first_visit_at: string | null
          last_name: string | null
          last_visit_at: string | null
          phone: string | null
          refreshed_at: string | null
          tenant_id: string | null
          total_spent_cents: number | null
          total_visits: number | null
          visit_frequency_days: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["favorite_category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_tenant_daily_metrics: {
        Row: {
          customers_active: number | null
          customers_new: number | null
          day: string | null
          refreshed_at: string | null
          revenue_cents: number | null
          tenant_id: string | null
          visits: number | null
        }
        Relationships: []
      }
      mv_visit_heatmap: {
        Row: {
          dow: number | null
          hour: number | null
          tenant_id: string | null
          visit_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "visits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_churn_risk: {
        Row: {
          customer_id: string | null
          days_since_last_visit: number | null
          favorite_item_name: string | null
          first_name: string | null
          last_name: string | null
          last_visit_at: string | null
          phone: string | null
          tenant_id: string | null
          total_spent_cents: number | null
          total_visits: number | null
          visit_frequency_days: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_customer_stats: {
        Row: {
          avg_ticket_cents: number | null
          customer_id: string | null
          days_since_last_visit: number | null
          favorite_category_id: string | null
          favorite_category_name: string | null
          favorite_item_id: string | null
          favorite_item_name: string | null
          first_name: string | null
          first_visit_at: string | null
          last_name: string | null
          last_visit_at: string | null
          phone: string | null
          refreshed_at: string | null
          tenant_id: string | null
          total_spent_cents: number | null
          total_visits: number | null
          visit_frequency_days: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["favorite_category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      v_tenant_daily_metrics: {
        Row: {
          customers_active: number | null
          customers_new: number | null
          day: string | null
          refreshed_at: string | null
          revenue_cents: number | null
          tenant_id: string | null
          visits: number | null
        }
        Relationships: []
      }
      v_visit_heatmap: {
        Row: {
          dow: number | null
          hour: number | null
          tenant_id: string | null
          visit_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "visits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _advance_punch_cards_for_visit: {
        Args: { p_customer_id: string; p_tenant_id: string; p_visit_id: string }
        Returns: Json
      }
      _check_staff_role: {
        Args: { p_allowed_roles: string[]; p_tenant_id: string }
        Returns: undefined
      }
      acc_account_balance: {
        Args: { p_account: string; p_tenant: string; p_to?: string }
        Returns: number
      }
      acc_accountant_tenant_ids: { Args: never; Returns: string[] }
      acc_admin_names: {
        Args: { p_tenant_id: string }
        Returns: {
          display_name: string
        }[]
      }
      acc_admin_tenant_ids: { Args: never; Returns: string[] }
      acc_allocate: {
        Args: { p_date: string; p_pairs: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_arca_disconnect: {
        Args: { p_confirm: string; p_environment: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_arca_get_credentials: {
        Args: {
          p_environment: string
          p_secret_key: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_arca_padron_cache_put: {
        Args: { p_environment: string; p_rows: Json; p_tenant_id: string }
        Returns: number
      }
      acc_arca_record_test: {
        Args: { p_environment: string; p_result: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_arca_save_certificate: {
        Args: {
          p_certificate_pem: string
          p_environment: string
          p_expected_updated_at: string
          p_meta: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_arca_save_connection: {
        Args: {
          p_environment: string
          p_expected_updated_at: string
          p_patch: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_arca_store_keypair: {
        Args: {
          p_alias: string
          p_cert_cuit: string
          p_csr_pem: string
          p_environment: string
          p_mode?: string
          p_private_key_pem: string
          p_public_key_sha256: string
          p_secret_key: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_arca_ticket_drop: {
        Args: { p_environment: string; p_service: string; p_tenant_id: string }
        Returns: boolean
      }
      acc_arca_ticket_get: {
        Args: {
          p_clear_manual_cooldown?: boolean
          p_environment: string
          p_lease_seconds?: number
          p_secret_key: string
          p_service: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_arca_ticket_put: {
        Args: {
          p_environment: string
          p_lease_id: string
          p_result: Json
          p_secret_key: string
          p_service: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      acc_arca_voucher_reserve: {
        Args: {
          p_cbte_tipo: number
          p_environment: string
          p_payload: Json
          p_point_of_sale: number
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_arca_voucher_update: {
        Args: {
          p_patch: Json
          p_tenant_id: string
          p_to: string
          p_voucher_id: string
        }
        Returns: Json
      }
      acc_assert_admin: { Args: { p_tenant: string }; Returns: undefined }
      acc_assert_buyer: { Args: { p_tenant: string }; Returns: undefined }
      acc_assert_buyer_writer: { Args: { p_tenant: string }; Returns: undefined }
      acc_assert_reader: { Args: { p_tenant: string }; Returns: undefined }
      acc_assert_writer: { Args: { p_tenant: string }; Returns: undefined }
      acc_attach_document_file: {
        Args: {
          p_document_id: string
          p_file_name: string
          p_mime_type: string
          p_path: string
          p_size_bytes: number
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_bootstrap: {
        Args: { p_payload: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_buyer_tenant_ids: { Args: never; Returns: string[] }
      acc_check_integrity: {
        Args: { p_tenant_id: string }
        Returns: {
          check_key: string
          detail: Json
          ok: boolean
        }[]
      }
      acc_claim_admin: { Args: { p_tenant_id: string }; Returns: undefined }
      acc_close_fiscal_year: {
        Args: {
          p_expected: Json
          p_fiscal_year_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_close_period: {
        Args: { p_month: string; p_options: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_compute_iva_position: {
        Args: { p_month: string; p_tenant: string }
        Returns: Json
      }
      acc_create_parties_bulk: {
        Args: { p_kind: string; p_names: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_create_recurring_bulk: {
        Args: { p_items: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_cuit_is_valid: { Args: { p: string }; Returns: boolean }
      acc_delete_party: {
        Args: {
          p_expected_updated_at: string
          p_party_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_delete_recurring_expense: {
        Args: {
          p_expected_updated_at: string
          p_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_detach_document_file: {
        Args: { p_attachment_id: string; p_tenant_id: string }
        Returns: Json
      }
      acc_doc_label: {
        Args: {
          p_kind: string
          p_number: number
          p_point_of_sale: number
          p_voucher_type: string
        }
        Returns: string
      }
      acc_ensure_final_consumer: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      acc_entry_number_base: {
        Args: { p_fiscal_year: string }
        Returns: number
      }
      acc_form_defaults: {
        Args: { p_party_id: string; p_tenant_id: string }
        Returns: Json
      }
      acc_generate_iva_settlement: {
        Args: { p_expected: Json; p_month: string; p_tenant_id: string }
        Returns: Json
      }
      acc_grant_access: {
        Args: {
          p_display_name: string
          p_is_admin: boolean
          p_tenant_id: string
          p_user_id: string
        }
        Returns: Json
      }
      acc_guide_mark: {
        Args: {
          p_done: boolean
          p_guide: string
          p_step: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      acc_import_accounts: {
        Args: { p_dry_run: boolean; p_rows: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_add_items: {
        Args: { p_batch_id: string; p_items: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_add_items_service: {
        Args: { p_batch_id: string; p_items: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_cancel_batch: {
        Args: { p_batch_id: string; p_reason: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_import_create_batch: {
        Args: { p_batch: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_create_batch_service: {
        Args: { p_batch: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_delete_rule: {
        Args: { p_rule_id: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_import_mark_posted: {
        Args: {
          p_batch_id: string
          p_document_id: string
          p_key: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_import_match_purchases: {
        Args: { p_rows: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_put_proposals: {
        Args: { p_batch_id: string; p_proposals: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_save_layout: {
        Args: { p_layout: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_import_save_rule: {
        Args: {
          p_expected_updated_at: string
          p_rule: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_import_set_items: {
        Args: { p_batch_id: string; p_changes: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_isolation_gaps: { Args: never; Returns: string[] }
      acc_mark_treasury_checked: {
        Args: {
          p_as_of: string
          p_counted_cents: number
          p_expected_book_cents: number
          p_tenant_id: string
          p_treasury_id: string
        }
        Returns: Json
      }
      acc_member_is_protected: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: boolean
      }
      acc_member_labels: {
        Args: { p_tenant_id: string }
        Returns: {
          label: string
          user_id: string
        }[]
      }
      acc_mp_disconnect: { Args: { p_tenant_id: string }; Returns: undefined }
      acc_mp_get_token: {
        Args: { p_secret_key: string; p_tenant_id: string }
        Returns: string
      }
      acc_mp_save_connection: {
        Args: {
          p_expected_updated_at: string
          p_patch: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_mp_store_token: {
        Args: {
          p_meta: Json
          p_secret_key: string
          p_tenant_id: string
          p_token: string
        }
        Returns: Json
      }
      acc_mp_sync_record_service: {
        Args: { p_patch: Json; p_tenant_id: string }
        Returns: undefined
      }
      acc_mp_sync_targets_service: {
        Args: { p_secret_key: string }
        Returns: Json
      }
      acc_my_access: { Args: { p_tenant: string }; Returns: Json }
      acc_open_amount: {
        Args: { p_as_of?: string; p_line_id: string }
        Returns: number
      }
      acc_payroll_prepare: {
        Args: {
          p_client_ref: string
          p_employee_id: string
          p_kind: string
          p_month: string
          p_off_books?: boolean
          p_period_from?: string
          p_period_to?: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      acc_payroll_prepare_accrual: {
        Args: { p_client_ref: string; p_month: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_payroll_prepare_movement: {
        Args: {
          p_client_ref: string
          p_employee_id: string
          p_kind: string
          p_month: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      acc_platform_designate_admin: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      acc_pos_cash_dismiss: {
        Args: { p_movement_id: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_pos_cash_link: {
        Args: { p_client_ref: string; p_movement_id: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_pos_cash_pending: {
        Args: { p_branch_id?: string; p_tenant_id: string }
        Returns: Json
      }
      acc_possible_duplicate: {
        Args: {
          p_issue_date: string
          p_number: number
          p_party_id: string
          p_point_of_sale: number
          p_tenant_id: string
          p_total_cents: number
          p_voucher_type: string
        }
        Returns: Json
      }
      acc_post_bundle: {
        Args: { p_bundle: Json; p_client_ref: string; p_tenant_id: string }
        Returns: Json
      }
      acc_posting_context: { Args: { p_tenant_id: string }; Returns: Json }
      acc_privilege_gaps: { Args: never; Returns: string[] }
      acc_quick_expense_suggestions: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      acc_reader_tenant_ids: { Args: never; Returns: string[] }
      acc_reimpute_line: {
        Args: {
          p_account_id: string
          p_line_id: string
          p_reason: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_remap_system_account: {
        Args: {
          p_account_id: string
          p_system_key: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_reopen_fiscal_year: {
        Args: {
          p_fiscal_year_id: string
          p_reason: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_reopen_period: {
        Args: { p_month: string; p_reason: string; p_tenant_id: string }
        Returns: Json
      }
      acc_report_cash_daily: {
        Args: { p_branch_id?: string; p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          active: boolean
          closing_cents: number
          days: Json
          kind: string
          name: string
          opening_cents: number
          treasury_id: string
        }[]
      }
      acc_report_cash_flow: {
        Args: { p_branch_id?: string; p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          category: string
          inflow_cents: number
          month: string
          outflow_cents: number
        }[]
      }
      acc_report_cash_projection: {
        Args: { p_as_of: string; p_branch_id?: string; p_tenant_id: string; p_weeks?: number }
        Returns: {
          expected_in_cents: number
          expected_out_cents: number
          projected_balance_cents: number
          week_start: string
        }[]
      }
      acc_report_close_checklist: {
        Args: { p_month: string; p_tenant_id: string }
        Returns: Json
      }
      acc_report_imputation_flags: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          accounting_date: string
          amount_cents: number
          description: string
          document_id: string
          document_line_id: string
          party_name: string
          seq: number
          usual_account_code: string
          usual_account_id: string
          usual_account_name: string
        }[]
      }
      acc_report_integrity: {
        Args: { p_tenant_id: string }
        Returns: {
          check_key: string
          detail: Json
          ok: boolean
        }[]
      }
      acc_report_iva_aliquots: {
        Args: {
          p_after?: Json
          p_book: string
          p_limit?: number
          p_month: string
          p_tenant_id: string
        }
        Returns: {
          afip_aliquot_code: number
          afip_voucher_code: number
          counterparty_doc_number: string
          counterparty_doc_type: number
          counterparty_name: string
          cursor: Json
          document_id: string
          document_seq: number
          net_cents: number
          number_from: number
          number_to: number
          point_of_sale: number
          sign: number
          total_rows: number
          vat_cents: number
          vat_rate_bp: number
          voucher_date: string
          voucher_id: string
          voucher_type: string
        }[]
      }
      acc_report_iva_book: {
        Args: {
          p_after?: Json
          p_book: string
          p_limit?: number
          p_month: string
          p_tenant_id: string
        }
        Returns: {
          accounting_date: string
          afip_voucher_code: number
          amounts: Json
          channel: string
          counterparty_doc_number: string
          counterparty_doc_type: number
          counterparty_iva_condition: string
          counterparty_name: string
          cursor: Json
          document_id: string
          document_seq: number
          is_reversal: boolean
          number_from: number
          number_to: number
          point_of_sale: number
          sign: number
          total_rows: number
          voucher_date: string
          voucher_id: string
          voucher_type: string
        }[]
      }
      acc_report_iva_book_totals: {
        Args: { p_book: string; p_month: string; p_tenant_id: string }
        Returns: Json
      }
      acc_report_iva_position: {
        Args: { p_month: string; p_tenant_id: string }
        Returns: Json
      }
      acc_report_journal: {
        Args: {
          p_after?: Json
          p_from: string
          p_limit?: number
          p_tenant_id: string
          p_to: string
        }
        Returns: {
          created_by_name: string
          cursor: Json
          description: string
          document_id: string
          document_kind: string
          document_label: string
          document_seq: number
          entry_date: string
          entry_id: string
          kind: string
          lines: Json
          number: number
          number_is_provisional: boolean
          total_cents: number
          total_entries: number
        }[]
      }
      acc_report_journal_import: {
        Args: {
          p_after?: Json
          p_from: string
          p_limit?: number
          p_tenant_id: string
          p_to: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          credit_cents: number
          cursor: Json
          debit_cents: number
          document_id: string
          document_label: string
          entry_date: string
          entry_id: string
          entry_kind: string
          entry_number: number
          legend: string
          line_no: number
          number_is_provisional: boolean
          party_id: string
          party_name: string
          party_tax_id: string
          total_rows: number
        }[]
      }
      acc_report_ledger: {
        Args: {
          p_account_id: string
          p_after?: Json
          p_from?: string
          p_limit?: number
          p_party_id?: string
          p_tenant_id: string
          p_to?: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          credit_cents: number
          cursor: Json
          debit_cents: number
          description: string
          document_id: string
          document_label: string
          document_seq: number
          due_date: string
          entry_date: string
          entry_id: string
          entry_number: number
          memo: string
          number_is_provisional: boolean
          party_id: string
          party_name: string
          row_kind: string
          running_balance_cents: number
          total_rows: number
        }[]
      }
      acc_report_month_package: {
        Args: { p_month: string; p_tenant_id: string }
        Returns: Json
      }
      acc_report_net_by_method: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          channel: string
          commission_cents: number
          commission_vat_cents: number
          credited_cents: number
          discount_bp: number
          method_id: string
          method_name: string
          other_charges_cents: number
          pending_cents: number
          sold_cents: number
          unexplained_cents: number
          withholdings_cents: number
        }[]
      }
      acc_report_onboarding: { Args: { p_tenant_id: string }; Returns: Json }
      acc_report_open_items: {
        Args: {
          p_account_id?: string
          p_as_of: string
          p_branch_id?: string
          p_party_id: string
          p_side: string
          p_tenant_id: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          amount_cents: number
          bucket: string
          days_overdue: number
          document_id: string
          document_kind: string
          document_label: string
          document_seq: number
          due_date: string
          entry_date: string
          line_id: string
          memo: string
          open_cents: number
          sales_method_id: string
          side: Database["public"]["Enums"]["acc_side"]
        }[]
      }
      acc_report_party_balances: {
        Args: { p_as_of: string; p_branch_id?: string; p_group: string; p_tenant_id: string }
        Returns: {
          active: boolean
          credit_cents: number
          debt_cents: number
          due_soon_cents: number
          last_increase_date: string
          net_cents: number
          next_due_date: string
          no_due_cents: number
          not_due_cents: number
          oldest_due_date: string
          overdue_1_30_cents: number
          overdue_31_60_cents: number
          overdue_60_plus_cents: number
          overdue_cents: number
          party_id: string
          party_kind: string
          party_name: string
          system_key: string
          tax_id: string
          trade_name: string
          traffic_light: string
          traffic_text: string
        }[]
      }
      acc_report_party_statement: {
        Args: {
          p_account_id: string
          p_after?: Json
          p_branch_id?: string
          p_from: string
          p_limit?: number
          p_party_id: string
          p_tenant_id: string
          p_to: string
        }
        Returns: {
          account_id: string
          cursor: Json
          decrease_cents: number
          document_id: string
          document_kind: string
          document_label: string
          document_seq: number
          due_date: string
          entry_date: string
          entry_id: string
          increase_cents: number
          line_id: string
          memo: string
          open_cents: number
          row_kind: string
          running_balance_cents: number
          total_rows: number
        }[]
      }
      acc_report_payroll: {
        Args: { p_branch_id?: string; p_month: string; p_tenant_id: string }
        Returns: Json
      }
      acc_report_recurring_status: {
        Args: { p_branch_id?: string; p_tenant_id: string }
        Returns: {
          accounting_date: string
          document_id: string
          document_kind: string
          due_date: string
          open_cents: number
          paid_cents: number
          prior_open_cents: number
          recurring_expense_id: string
          total_cents: number
        }[]
      }
      acc_report_sales_projection: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          cash_counted_cents: number
          closes: number
          day: string
          delivery_cents: number
          delivery_commission_cents: number
          events_cents: number
          events_commission_cents: number
          note: string
          salon_cents: number
          salon_commission_cents: number
          target_cents: number
        }[]
      }
      acc_report_sales_summary: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          channel: string
          invoiced_net_cents: number
          month: string
          sold_cents: number
          uninvoiced_cents: number
          vat_cents: number
        }[]
      }
      acc_report_subledger: {
        Args: {
          p_after?: Json
          p_from: string
          p_kind: string
          p_limit?: number
          p_tenant_id: string
          p_to: string
          p_treasury_id?: string
        }
        Returns: {
          cursor: Json
          row: Json
          total_rows: number
        }[]
      }
      acc_report_subledger_purchases: {
        Args: {
          p_after?: Json
          p_from: string
          p_kind: string
          p_limit?: number
          p_tenant_id: string
          p_to: string
        }
        Returns: {
          cursor: Json
          row: Json
          total_rows: number
        }[]
      }
      acc_report_subledger_sales: {
        Args: {
          p_after?: Json
          p_from: string
          p_kind: string
          p_limit?: number
          p_tenant_id: string
          p_to: string
        }
        Returns: {
          cursor: Json
          row: Json
          total_rows: number
        }[]
      }
      acc_report_summary: {
        Args: { p_as_of: string; p_tenant_id: string }
        Returns: Json
      }
      acc_report_treasury_balances: {
        Args: { p_as_of: string; p_branch_id?: string; p_tenant_id: string }
        Returns: {
          account_code: string
          account_id: string
          active: boolean
          balance_cents: number
          branch_id: string
          kind: string
          last_checked_on: string
          last_movement_date: string
          name: string
          pending_wallet_cents: number
          sort: number
          treasury_id: string
        }[]
      }
      acc_report_trial_balance: {
        Args: {
          p_exclude_fy_result?: boolean
          p_from: string
          p_tenant_id: string
          p_to: string
        }
        Returns: {
          account_id: string
          account_type: Database["public"]["Enums"]["acc_account_type"]
          active: boolean
          closing_credit_cents: number
          closing_debit_cents: number
          code: string
          is_virtual: boolean
          level: number
          name: string
          normal_side: Database["public"]["Enums"]["acc_side"]
          opening_credit_cents: number
          opening_debit_cents: number
          period_credit_cents: number
          period_debit_cents: number
          postable: boolean
        }[]
      }
      acc_report_verify_closed_periods: {
        Args: { p_tenant_id: string }
        Returns: {
          current_hash: string
          label: string
          ok: boolean
          period_id: string
          stored_hash: string
        }[]
      }
      acc_report_week_plan: {
        Args: { p_branch_id?: string; p_tenant_id: string; p_week_start: string }
        Returns: {
          budget_cents: number
          debt_cents: number
          default_voucher_type: string
          overdue_cents: number
          paid_cents: number
          party_id: string
          party_kind: string
          party_name: string
          purchased_cents: number
        }[]
      }
      acc_reverse_document: {
        Args: {
          p_client_ref: string
          p_document_id: string
          p_options: Json
          p_reason: string
          p_reversal_date: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_revoke_access: {
        Args: { p_reason: string; p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      acc_rpc_isolation_gaps: { Args: never; Returns: string[] }
      acc_sales_range_defaults: { Args: { p_tenant_id: string }; Returns: Json }
      acc_save_account: {
        Args: {
          p_account: Json
          p_expected_updated_at: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_daily_cash: {
        Args: { p_day: string; p_items: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_save_employee: {
        Args: { p_employee: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_save_employee_salary: {
        Args: {
          p_employee_id: string
          p_month: string
          p_salary_cents: number
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_employee_salary_parts: {
        Args: {
          p_declared_cents: number
          p_employee_id: string
          p_month: string
          p_off_books_cents: number
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_party: {
        Args: {
          p_expected_updated_at: string
          p_party: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_payment_budget: {
        Args: { p_items: Json; p_tenant_id: string; p_week_start: string }
        Returns: Json
      }
      acc_save_recurring_expense: {
        Args: {
          p_expected_updated_at: string
          p_expense: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_sales_method: {
        Args: {
          p_expected_updated_at: string
          p_method: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_sales_point: {
        Args: {
          p_expected_updated_at: string
          p_point: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_sales_targets: {
        Args: { p_items: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_save_settings: {
        Args: {
          p_expected_updated_at: string
          p_settings: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_save_tax_settings: {
        Args: { p_settings: Json; p_tenant_id: string }
        Returns: Json
      }
      acc_save_treasury_account: {
        Args: {
          p_expected_updated_at: string
          p_tenant_id: string
          p_treasury: Json
        }
        Returns: Json
      }
      acc_set_access: {
        Args: {
          p_display_name?: string
          p_is_admin?: boolean
          p_scope: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: Json
      }
      acc_set_card_installments: {
        Args: {
          p_bundle_id: string
          p_installments: number
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_set_treasury_bank_tax: {
        Args: { p_tenant_id: string; p_treasury_id: string; p_value: boolean }
        Returns: undefined
      }
      acc_set_document_branch: {
        Args: {
          p_branch_id: string
          p_document_id: string
          p_reason?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_skip_opening: { Args: { p_tenant_id: string }; Returns: undefined }
      acc_skip_recurring_due: {
        Args: { p_due_date: string; p_id: string; p_tenant_id: string }
        Returns: Json
      }
      acc_today: { Args: { p_tenant: string }; Returns: string }
      acc_treasury_check: {
        Args: { p_as_of: string; p_tenant_id: string; p_treasury_id: string }
        Returns: Json
      }
      acc_unallocate: {
        Args: { p_allocation_id: string; p_reason: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_upload_link_add: {
        Args: {
          p_file_name: string
          p_mime_type: string
          p_path: string
          p_size_bytes: number
          p_token: string
        }
        Returns: Json
      }
      acc_upload_link_close: {
        Args: { p_link_id: string; p_tenant_id: string }
        Returns: undefined
      }
      acc_upload_link_create: {
        Args: {
          p_expires_at: string
          p_link_id: string
          p_slots: Json
          p_tenant_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      acc_upload_link_files_list: {
        Args: { p_link_id: string; p_tenant_id: string }
        Returns: Json
      }
      acc_upload_link_open: { Args: { p_token: string }; Returns: Json }
      acc_void_document: {
        Args: {
          p_document_id: string
          p_options: Json
          p_reason: string
          p_tenant_id: string
        }
        Returns: Json
      }
      acc_writer_tenant_ids: { Args: never; Returns: string[] }
      accept_invitation: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      activate_table_session: {
        Args: {
          p_alias?: string
          p_party_size: number
          p_qr_token: string
          p_source?: string
        }
        Returns: Json
      }
      activate_table_session_by_id: {
        Args: {
          p_alias?: string
          p_party_size: number
          p_physical_table_id: string
          p_source?: string
        }
        Returns: Json
      }
      active_tenant_id: { Args: never; Returns: string }
      add_punch_stamp: {
        Args: {
          p_customer_id: string
          p_qty?: number
          p_source?: string
          p_template_id: string
          p_visit_id?: string
        }
        Returns: Json
      }
      add_staff_ticket: {
        Args: {
          p_assigned_to_guest_id?: string
          p_items: Json
          p_session_id: string
        }
        Returns: Json
      }
      auto_abandon_stale_sessions: { Args: never; Returns: Json }
      award_points_by_amount: {
        Args: { p_amount_cents: number; p_customer_id: string }
        Returns: Json
      }
      bump_landing_view: { Args: { p_page: string }; Returns: undefined }
      calculate_visit_points: {
        Args: { p_visit_id: string }
        Returns: {
          breakdown: Json
          delta: number
        }[]
      }
      cancel_pending_ticket: {
        Args: { p_browser_token: string; p_ticket_id: string }
        Returns: Json
      }
      cancel_reward_redemption: {
        Args: { p_qr_token: string; p_redemption_id: string }
        Returns: undefined
      }
      cancel_ticket_item: {
        Args: { p_reason: string; p_ticket_item_id: string }
        Returns: Json
      }
      carta_menu_rev: { Args: { p_tenant: string }; Returns: number }
      check_slug_available: { Args: { p_slug: string }; Returns: boolean }
      claim_broadcast_recipient: { Args: { p_id: string }; Returns: boolean }
      claim_jobs: {
        Args: { p_kind?: string; p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          kind: string
          locked_at: string | null
          max_attempts: number
          payload: Json
          run_at: string
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pending_redemption: {
        Args: {
          p_qr_token: string
          p_redemption_id: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      close_table: {
        Args: { p_customer_id: string; p_items: Json; p_notes?: string }
        Returns: {
          breakdown: Json
          points_awarded: number
          visit_id: string
        }[]
      }
      club_has_password: {
        Args: { p_link_slug: string; p_phone: string }
        Returns: boolean
      }
      club_login: {
        Args: { p_link_slug: string; p_password: string; p_phone: string }
        Returns: Json
      }
      club_request_reset: {
        Args: { p_ip?: string; p_link_slug: string; p_phone: string }
        Returns: Json
      }
      club_set_password_with_ticket: {
        Args: { p_password: string; p_reset_ticket: string }
        Returns: Json
      }
      club_verify_reset_code: {
        Args: { p_code: string; p_link_slug: string; p_phone: string }
        Returns: Json
      }
      complete_job: { Args: { p_id: string }; Returns: undefined }
      create_tenant_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          brand_accent: string | null
          category_window_months: number
          created_at: string
          currency: string
          default_event_attendance_points: number
          feature_flags: Json
          feedback_whatsapp_phone: string | null
          google_maps_review_url: string | null
          guest_idle_hours_to_rescan: number
          id: string
          kitchen_flow_enabled: boolean
          logo_url: string | null
          name: string
          points_redemption_enabled: boolean
          points_redemption_max_pct: number
          points_to_cents_rate: number
          review_gating_enabled: boolean
          review_reward_points: number
          session_auto_abandon_hours: number
          settings: Json
          slug: string
          ticket_auto_accept_enabled: boolean
          ticket_auto_accept_max_cents: number | null
          ticket_auto_accept_max_items: number | null
          timezone: string
          total_seats: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      customer_effective_tier: {
        Args: { p_customer_id: string }
        Returns: string
      }
      customers_for_birthday_flow: {
        Args: { p_flow_id: string }
        Returns: {
          customer_id: string
        }[]
      }
      customers_for_inactive_flow: {
        Args: { p_days: number; p_flow_id: string }
        Returns: {
          customer_id: string
        }[]
      }
      decrypt_meta_token: {
        Args: { ciphertext: string; key: string }
        Returns: string
      }
      default_branch_id: { Args: { p_tenant_id: string }; Returns: string }
      delete_category_cascade: {
        Args: { p_category_id: string }
        Returns: Json
      }
      deliver_reward_redemption: {
        Args: { p_redeem_token: string }
        Returns: Json
      }
      encrypt_meta_token: {
        Args: { key: string; plaintext: string }
        Returns: string
      }
      enqueue_job: {
        Args: {
          p_kind: string
          p_max_attempts?: number
          p_payload: Json
          p_run_at?: string
          p_tenant_id: string
        }
        Returns: string
      }
      ensure_scheduled_event_for_template: {
        Args: {
          p_branch_id?: string
          p_capacity?: number
          p_event_date: string
          p_starts_at_local?: string
          p_template_id: string
        }
        Returns: string
      }
      evaluate_audience_query: {
        Args: {
          p_limit?: number
          p_params?: Json
          p_tenant_id: string
          p_where: string
        }
        Returns: {
          count_total: number
          customer_id: string
        }[]
      }
      evaluate_day_capacity: {
        Args: { p_date: string; p_tenant_id: string }
        Returns: {
          available: number
          bucket: string
          capacity: number
          used: number
        }[]
      }
      expire_punch_cards: { Args: never; Returns: Json }
      f_unaccent: { Args: { "": string }; Returns: string }
      fail_job: {
        Args: { p_error: string; p_id: string; p_recoverable?: boolean }
        Returns: undefined
      }
      find_user_id_by_email: { Args: { p_email: string }; Returns: string }
      flow_already_enrolled: {
        Args: { p_context?: Json; p_customer_id: string; p_flow_id: string }
        Returns: boolean
      }
      fp_create_table: {
        Args: {
          p_area_id: string
          p_capacity?: number
          p_label: string
          p_shape: Database["public"]["Enums"]["floor_element_shape"]
          p_x: number
          p_y: number
        }
        Returns: Json
      }
      fp_delete_area: { Args: { p_area_id: string }; Returns: Json }
      fp_delete_table: { Args: { p_table_id: string }; Returns: Json }
      fp_merge_tables: {
        Args: { p_absorbed_table_id: string; p_survivor_table_id: string }
        Returns: Json
      }
      fp_set_table_active: {
        Args: { p_active: boolean; p_table_id: string }
        Returns: Json
      }
      generate_qr_token: { Args: never; Returns: string }
      get_active_session_by_qr_token: {
        Args: { p_qr_token: string }
        Returns: {
          is_activated: boolean
          physical_table_id: string
          session_id: string
          table_label: string
          tenant_id: string
        }[]
      }
      get_invitation_preview: {
        Args: { p_token: string }
        Returns: {
          email: string
          expired: boolean
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_name: string
        }[]
      }
      get_loyalty_state: {
        Args: { p_browser_token: string; p_qr_token: string }
        Returns: Json
      }
      get_marketing_team: {
        Args: { p_tenant: string }
        Returns: {
          member_id: string
          member_name: string
          member_role: Database["public"]["Enums"]["tenant_role"]
        }[]
      }
      get_redemption_by_token: {
        Args: { p_redeem_token: string }
        Returns: Json
      }
      get_salon_occupancy: { Args: { p_tenant_id: string }; Returns: Json }
      get_session_state: {
        Args: { p_browser_token: string; p_qr_token: string }
        Returns: Json
      }
      get_tenant_access: { Args: { p_slug: string }; Returns: Json }
      get_tenant_members: {
        Args: { p_tenant: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          user_id: string
        }[]
      }
      grant_tier_benefits: {
        Args: never
        Returns: {
          granted_count: number
        }[]
      }
      ingest_inbound_message: {
        Args: {
          p_channel_id: string
          p_content: string
          p_customer_id: string
          p_external_user_id: string
          p_media: Json
          p_meta_message_id: string
          p_sent_at: string
          p_tenant_id: string
        }
        Returns: {
          conversation_id: string
          message_id: string
          was_new: boolean
        }[]
      }
      internal_activate_session_for_table: {
        Args: {
          p_alias?: string
          p_party_size: number
          p_source: string
          p_table_id: string
          p_user_id: string
        }
        Returns: Json
      }
      is_platform_admin: { Args: never; Returns: boolean }
      join_session_as_guest: {
        Args: {
          p_browser_token: string
          p_display_name?: string
          p_qr_token: string
        }
        Returns: Json
      }
      mark_broadcast_replied: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      mark_commission_paid: {
        Args: { p_ledger_ids: string[]; p_paid_at?: string }
        Returns: number
      }
      mark_session_abandoned: {
        Args: { p_reason?: string; p_session_id: string }
        Returns: Json
      }
      mark_session_paid: {
        Args: { p_redemptions?: Json; p_session_id: string }
        Returns: Json
      }
      marketing_manager_tenant_ids: { Args: never; Returns: string[] }
      marketing_member_tenant_ids: { Args: never; Returns: string[] }
      marketing_reorder_tasks: {
        Args: { p_group: string; p_ids: string[] }
        Returns: number
      }
      menu_apply_price_changes: {
        Args: { p_batch?: boolean; p_changes: Json; p_tenant_id: string }
        Returns: Json
      }
      menu_force_refresh: { Args: { p_tenant: string }; Returns: Json }
      merge_sessions: {
        Args: { p_absorbed_ids: string[]; p_survivor_id: string }
        Returns: Json
      }
      move_category: {
        Args: { p_category_id: string; p_new_parent_id: string }
        Returns: undefined
      }
      move_menu_items: {
        Args: { p_item_ids: string[]; p_target_category_id: string }
        Returns: number
      }
      move_session: {
        Args: { p_new_physical_table_id: string; p_session_id: string }
        Returns: Json
      }
      my_branches: { Args: { p_tenant_id: string }; Returns: Json }
      pos_add_discount: {
        Args: {
          p_kind: string
          p_reason: string
          p_session_id: string
          p_value: number
        }
        Returns: Json
      }
      pos_approvals_inbox: { Args: { p_branch_id: string }; Returns: Json }
      pos_bill: { Args: { p_session_id: string }; Returns: Json }
      pos_cancel_item: {
        Args: { p_item_id: string; p_reason: string }
        Returns: Json
      }
      pos_cash_move: {
        Args: {
          p_amount_cents: number
          p_employee_id?: string
          p_idempotency_key?: string
          p_kind: string
          p_party_id?: string
          p_period_from?: string
          p_period_to?: string
          p_photo_path?: string
          p_purpose?: string
          p_reason?: string
          p_shift_id: string
        }
        Returns: Json
      }
      pos_cash_movement: {
        Args: {
          p_amount_cents: number
          p_idempotency_key?: string
          p_kind: string
          p_photo_path?: string
          p_reason: string
          p_shift_id: string
        }
        Returns: Json
      }
      pos_cash_targets: { Args: { p_branch_id: string }; Returns: Json }
      pos_close_shift: {
        Args: {
          p_breakdown?: Json
          p_counted_cents: number
          p_leave_float_cents?: number
          p_note?: string
          p_shift_id: string
        }
        Returns: Json
      }
      pos_close_table: { Args: { p_session_id: string }; Returns: Json }
      pos_decide_approval: {
        Args: { p_approval_id: string; p_approve: boolean; p_note?: string }
        Returns: Json
      }
      pos_edit_payment: {
        Args: {
          p_invoice?: boolean
          p_method?: string
          p_note?: string
          p_payment_id: string
          p_surcharge?: boolean
        }
        Returns: Json
      }
      pos_fire_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      pos_floor_snapshot: { Args: { p_branch_id: string }; Returns: Json }
      pos_kitchen_advance: {
        Args: { p_station_ids?: string[]; p_ticket_id: string; p_to: string }
        Returns: Json
      }
      pos_kitchen_queue: { Args: { p_branch_id: string }; Returns: Json }
      pos_kitchen_seen: { Args: { p_ticket_ids: string[] }; Returns: number }
      pos_mark_served: {
        Args: {
          p_item_ids?: string[]
          p_only_ready?: boolean
          p_session_id: string
        }
        Returns: Json
      }
      pos_menu: { Args: { p_branch_id: string }; Returns: Json }
      pos_merge_tables: {
        Args: { p_from: string; p_into: string }
        Returns: Json
      }
      pos_move_table: {
        Args: { p_session_id: string; p_table_id: string }
        Returns: Json
      }
      pos_open_shift: {
        Args: {
          p_branch_id: string
          p_label?: string
          p_note?: string
          p_opening_float_cents: number
          p_practice?: boolean
          p_register_id?: string
        }
        Returns: Json
      }
      pos_open_table: {
        Args: {
          p_alias?: string
          p_customer_id?: string
          p_party_size: number
          p_practice?: boolean
          p_reservation_id?: string
          p_table_id: string
        }
        Returns: Json
      }
      pos_pay: {
        Args: {
          p_amount_cents: number
          p_idempotency_key?: string
          p_invoice?: boolean
          p_item_ids?: string[]
          p_method: string
          p_payer_label?: string
          p_reference?: string
          p_session_id: string
          p_shift_id?: string
          p_tendered_cents?: number
          p_tip_cents?: number
        }
        Returns: Json
      }
      pos_release_table: { Args: { p_session_id: string }; Returns: Json }
      pos_remove_discount: { Args: { p_discount_id: string }; Returns: Json }
      pos_request_bill: {
        Args: { p_on?: boolean; p_session_id: string }
        Returns: Json
      }
      pos_request_void: {
        Args: { p_item_id: string; p_reason: string }
        Returns: Json
      }
      pos_sales_days: {
        Args: {
          p_branch_id?: string
          p_from: string
          p_tenant_id: string
          p_to: string
        }
        Returns: Json
      }
      pos_send_order: {
        Args: {
          p_course?: number
          p_fire?: boolean
          p_idempotency_key?: string
          p_items: Json
          p_session_id: string
        }
        Returns: Json
      }
      pos_session_detail: { Args: { p_session_id: string }; Returns: Json }
      pos_set_practice: {
        Args: { p_branch_id: string; p_on: boolean }
        Returns: Json
      }
      pos_set_stockout: {
        Args: { p_branch_id: string; p_menu_item_id: string; p_on: boolean }
        Returns: Json
      }
      pos_shift_snapshot: {
        Args: { p_branch_id: string; p_practice?: boolean; p_shift_id?: string }
        Returns: Json
      }
      pos_update_table: {
        Args: {
          p_alias?: string
          p_clear_customer?: boolean
          p_customer_id?: string
          p_party_size?: number
          p_session_id: string
        }
        Returns: Json
      }
      pos_void_cash_movement: {
        Args: { p_movement_id: string; p_reason: string }
        Returns: Json
      }
      pos_void_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: Json
      }
      provision_reservation_manager: {
        Args: { p_tenant: string; p_user: string }
        Returns: string
      }
      punch_template_allows_customer: {
        Args: { p_customer_id: string; p_template_id: string }
        Returns: boolean
      }
      pur_events_between: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          capacity: number
          event_date: string
          name: string
          reserved_guests: number
          scheduled_event_id: string
          starts_at_local: string
          template_id: string
        }[]
      }
      pur_receive_order: {
        Args: { p_lines: Json; p_order_id: string; p_received_by_name: string }
        Returns: Json
      }
      pur_submit_count: {
        Args: { p_count_id: string; p_orders: Json }
        Returns: Json
      }
      recalc_event_commissions: {
        Args: { p_scheduled_event_id: string }
        Returns: undefined
      }
      recalc_reservation_commission: {
        Args: { p_reservation_id: string }
        Returns: undefined
      }
      recompute_broadcast_stats: {
        Args: { p_broadcast_id: string }
        Returns: undefined
      }
      recompute_customer_loyalty: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      redeem_reward: {
        Args: { p_customer_id: string; p_reward_id: string }
        Returns: {
          balance_after: number
          redemption_id: string
        }[]
      }
      refresh_all_category_points: {
        Args: never
        Returns: {
          updated_count: number
        }[]
      }
      refresh_stats: { Args: never; Returns: undefined }
      regenerate_qr_token: { Args: { p_table_id: string }; Returns: string }
      register_customer_for_session: {
        Args: {
          p_birthdate?: string
          p_browser_token: string
          p_first_name: string
          p_ip?: string
          p_last_name: string
          p_opt_in_marketing?: boolean
          p_phone: string
          p_qr_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      register_lunch_visit: {
        Args: { p_customer_id: string; p_template_id: string }
        Returns: Json
      }
      reject_ticket: {
        Args: { p_reason: string; p_ticket_id: string }
        Returns: Json
      }
      remove_punch_stamp: {
        Args: { p_card_id: string; p_qty?: number }
        Returns: Json
      }
      reorder_menu_categories: {
        Args: { p_ordered_ids: string[]; p_parent_id: string }
        Returns: undefined
      }
      reorder_menu_items: {
        Args: { p_category_id: string; p_ordered_ids: string[] }
        Returns: undefined
      }
      reorder_partner_benefits: {
        Args: { p_ordered_ids: string[]; p_partner_id: string }
        Returns: undefined
      }
      reorder_rewards: {
        Args: { p_ordered_ids: string[]; p_tenant_id: string }
        Returns: undefined
      }
      reorder_tier_benefits: {
        Args: { p_ordered_ids: string[]; p_tier_id: string }
        Returns: undefined
      }
      request_bill: {
        Args: { p_browser_token: string; p_qr_token: string }
        Returns: Json
      }
      request_reward_redemption: {
        Args: {
          p_qr_token: string
          p_reward_id: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      requeue_stuck_jobs: {
        Args: { p_threshold_seconds?: number }
        Returns: number
      }
      reservation_day_lock_key: {
        Args: { p_date: string; p_tenant_id: string }
        Returns: number
      }
      rotate_customer_qr_token: {
        Args: { p_customer_id: string }
        Returns: string
      }
      set_active_tenant: { Args: { p_tenant: string }; Returns: undefined }
      set_membership_branches: {
        Args: { p_branch_ids: string[]; p_tenant_id: string; p_user_id: string }
        Returns: Json
      }
      set_reservation_table_label: {
        Args: {
          p_reservation_id: string
          p_table_label: string
          p_tenant_id?: string
        }
        Returns: {
          id: string
          table_label: string
          updated_at: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      split_session: {
        Args: {
          p_guest_ids: string[]
          p_source_id: string
          p_target_physical_table_id: string
        }
        Returns: Json
      }
      start_flow_for_customer: {
        Args: { p_context?: Json; p_customer_id: string; p_flow_id: string }
        Returns: string
      }
      submit_capture: {
        Args: {
          p_birthdate?: string
          p_email?: string
          p_first_name: string
          p_ip: string
          p_last_name: string
          p_link_slug: string
          p_opt_in: boolean
          p_password?: string
          p_phone: string
          p_user_agent: string
        }
        Returns: Json
      }
      submit_landing_exam_result: {
        Args: {
          p_answers: Json
          p_attempt: number
          p_device_id: string
          p_duration_seconds: number
          p_left_screen: number
          p_name: string
          p_score: number
          p_slug: string
          p_stations: Json
          p_submission_id: string
          p_total: number
        }
        Returns: string
      }
      submit_ticket: {
        Args: {
          p_browser_token: string
          p_idempotency_key: string
          p_items: Json
          p_qr_token: string
        }
        Returns: Json
      }
      sync_broadcast_recipient_status: {
        Args: { p_message_id: string; p_status: string; p_timestamp: string }
        Returns: undefined
      }
      ticket_door_admit: {
        Args: {
          p_expected_inside: number
          p_guests: number
          p_order_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      ticket_door_lookup: {
        Args: {
          p_order_id?: string
          p_short_code?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      ticket_door_today: {
        Args: { p_branch_id?: string; p_tenant_id: string }
        Returns: Json
      }
      ticket_door_undo: {
        Args: { p_order_id: string; p_tenant_id: string }
        Returns: Json
      }
      ticketing_create_order: {
        Args: {
          p_client_ip: string
          p_event_id: string
          p_experience_id: string
          p_guest_name: string
          p_guest_phone: string
          p_marketing_opt_in: boolean
          p_meal_type: Database["public"]["Enums"]["meal_type"]
          p_option: string
          p_party_size: number
          p_tenant_id: string
        }
        Returns: {
          attention: string | null
          balance_cash_only: boolean
          branch_id: string
          client_ip: string | null
          created_at: string
          customer_id: string | null
          event_date: string
          event_time: string
          experience_id: string | null
          full_price_cents: number
          guest_name: string
          guest_phone: string
          hold_expires_at: string
          id: string
          marketing_opt_in: boolean
          meal_type: Database["public"]["Enums"]["meal_type"]
          mp_payment_id: string | null
          mp_payment_type: string | null
          mp_preference_id: string | null
          mp_status: string | null
          mp_status_detail: string | null
          paid_at: string | null
          paid_cents: number | null
          party_size: number
          payment_option: string
          reservation_id: string | null
          scheduled_event_id: string | null
          status: string
          tenant_id: string
          terms: string | null
          title: string
          total_cents: number
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ticketing_event_seats: {
        Args: { p_event_ids: string[]; p_tenant_id: string }
        Returns: {
          capacity: number
          held: number
          scheduled_event_id: string
          taken: number
        }[]
      }
      ticketing_format_ars: { Args: { p_cents: number }; Returns: string }
      ticketing_online_manager: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      ticketing_settle_order: {
        Args: {
          p_mp_status: string
          p_mp_status_detail: string
          p_order_id: string
          p_paid_at: string
          p_paid_cents: number
          p_payment_id: string
          p_payment_type: string
          p_tenant_id: string
        }
        Returns: Json
      }
      transition_reservation_status: {
        Args: {
          p_actual_guests?: number
          p_reservation_id: string
          p_to: Database["public"]["Enums"]["salon_reservation_status"]
        }
        Returns: {
          actual_guests: number | null
          arrived_at: string | null
          arrived_by: string | null
          assistant_manager_id: string | null
          branch_id: string
          cake_count: number
          cake_option_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          champagne_count: number
          closed_at: string | null
          closed_by: string | null
          comments: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deposit_cents: number
          estimated_guests: number
          guest_email: string | null
          guest_instagram: string | null
          guest_name: string
          guest_phone: string | null
          highlight_comment: boolean
          id: string
          kind: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_end_time_local: string | null
          reservation_time_local: string
          scheduled_event_id: string | null
          seated_at: string | null
          seated_by: string | null
          service_alerts: Database["public"]["Enums"]["service_alert"][]
          status: Database["public"]["Enums"]["salon_reservation_status"]
          table_label: string | null
          tenant_id: string
          updated_at: string
          zone: Database["public"]["Enums"]["salon_zone"] | null
        }
        SetofOptions: {
          from: "*"
          to: "salon_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_message_status: {
        Args: {
          p_error: string
          p_meta_message_id: string
          p_status: Database["public"]["Enums"]["message_status"]
          p_timestamp: string
        }
        Returns: string
      }
      update_reservation_actual_guests: {
        Args: { p_actual_guests: number; p_reservation_id: string }
        Returns: {
          actual_guests: number | null
          arrived_at: string | null
          arrived_by: string | null
          assistant_manager_id: string | null
          branch_id: string
          cake_count: number
          cake_option_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          champagne_count: number
          closed_at: string | null
          closed_by: string | null
          comments: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deposit_cents: number
          estimated_guests: number
          guest_email: string | null
          guest_instagram: string | null
          guest_name: string
          guest_phone: string | null
          highlight_comment: boolean
          id: string
          kind: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_end_time_local: string | null
          reservation_time_local: string
          scheduled_event_id: string | null
          seated_at: string | null
          seated_by: string | null
          service_alerts: Database["public"]["Enums"]["service_alert"][]
          status: Database["public"]["Enums"]["salon_reservation_status"]
          table_label: string | null
          tenant_id: string
          updated_at: string
          zone: Database["public"]["Enums"]["salon_zone"] | null
        }
        SetofOptions: {
          from: "*"
          to: "salon_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_session_alias: {
        Args: { p_alias: string; p_session_id: string }
        Returns: Json
      }
      update_session_party_size: {
        Args: { p_party_size: number; p_session_id: string }
        Returns: Json
      }
      update_ticket_status: {
        Args: {
          p_new_status: Database["public"]["Enums"]["ticket_status"]
          p_ticket_id: string
        }
        Returns: Json
      }
      user_branch_ids: { Args: { p_tenant_id: string }; Returns: string[] }
      user_has_kitchen_role: { Args: { p_tenant_id: string }; Returns: boolean }
      user_role_in_tenant: {
        Args: { p_tenant: string }
        Returns: Database["public"]["Enums"]["tenant_role"]
      }
      user_tenant_ids: { Args: never; Returns: string[] }
      wallet_notify: { Args: { p_customer_id: string }; Returns: undefined }
      wallet_pulse: { Args: { p_qr_token: string }; Returns: Json }
      wallet_topic: { Args: { p_qr_token: string }; Returns: string }
    }
    Enums: {
      acc_account_type: "asset" | "liability" | "equity" | "income" | "expense"
      acc_side: "debit" | "credit"
      broadcast_status:
        | "draft"
        | "scheduled"
        | "sending"
        | "sent"
        | "failed"
        | "cancelled"
        | "partial"
      channel_status: "connected" | "disconnected" | "error"
      channel_type: "whatsapp" | "instagram"
      customer_acquisition_channel: "reservation" | "walkin" | "import"
      customer_source: "qr" | "manual" | "import"
      floor_element_kind:
        | "table"
        | "wall"
        | "pillar"
        | "island"
        | "bar"
        | "door"
        | "text"
        | "stage"
        | "booth"
      floor_element_shape: "rect" | "circle" | "banquette"
      flow_execution_status: "running" | "completed" | "failed" | "cancelled"
      flow_step_type: "send_template" | "wait" | "condition" | "add_tag"
      flow_trigger_type:
        | "customer_inactive"
        | "birthday"
        | "after_visit"
        | "event_starting"
        | "tag_added"
      job_status: "pending" | "processing" | "done" | "failed"
      marketing_task_category: "eventos" | "promociones" | "impresiones"
      marketing_task_kind:
        | "design"
        | "shoot"
        | "edit"
        | "script"
        | "ads"
        | "publish"
        | "print"
        | "coordinate"
        | "other"
      marketing_task_status:
        | "todo"
        | "in_progress"
        | "blocked"
        | "done"
        | "backlog"
        | "waiting_feedback"
      meal_type: "breakfast" | "lunch" | "tea_time" | "dinner" | "hub_event"
      message_direction: "inbound" | "outbound"
      message_status: "queued" | "sent" | "delivered" | "read" | "failed"
      points_rule_type: "per_amount" | "per_item"
      punch_trigger_type:
        | "item"
        | "category"
        | "tag"
        | "visit_window"
        | "manual"
      recipient_status:
        | "pending"
        | "sending"
        | "sent"
        | "delivered"
        | "read"
        | "replied"
        | "failed"
      redemption_status: "pending" | "delivered" | "cancelled"
      reservation_kind: "normal" | "birthday" | "special"
      reservation_origin:
        | "whatsapp"
        | "instagram"
        | "messenger"
        | "in_person"
        | "partner_referral"
        | "web"
      salon_reservation_status:
        | "pending"
        | "arrived"
        | "seated"
        | "closed"
        | "no_show"
        | "cancelled"
      salon_zone: "planta_alta" | "planta_baja" | "event_floating"
      service_alert:
        | "celiac"
        | "allergy"
        | "vegetarian"
        | "vegan"
        | "reduced_mobility"
        | "baby_seat"
      session_event_type:
        | "session_opened"
        | "guest_joined"
        | "guest_registered"
        | "bill_requested"
        | "session_paid"
        | "session_merged"
        | "session_split"
        | "session_abandoned"
        | "session_moved"
        | "party_size_changed"
        | "alias_changed"
      session_status: "open" | "paid" | "merged" | "abandoned"
      template_status:
        | "draft"
        | "pending"
        | "approved"
        | "rejected"
        | "disabled"
      tenant_role:
        | "owner"
        | "cashier"
        | "waiter"
        | "kitchen"
        | "editor"
        | "host"
        | "accountant"
      ticket_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "served"
        | "cancelled"
      tier_benefit_cadence: "none" | "birthday" | "monthly"
      visit_source: "cashier" | "import"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      acc_account_type: ["asset", "liability", "equity", "income", "expense"],
      acc_side: ["debit", "credit"],
      broadcast_status: [
        "draft",
        "scheduled",
        "sending",
        "sent",
        "failed",
        "cancelled",
        "partial",
      ],
      channel_status: ["connected", "disconnected", "error"],
      channel_type: ["whatsapp", "instagram"],
      customer_acquisition_channel: ["reservation", "walkin", "import"],
      customer_source: ["qr", "manual", "import"],
      floor_element_kind: [
        "table",
        "wall",
        "pillar",
        "island",
        "bar",
        "door",
        "text",
        "stage",
        "booth",
      ],
      floor_element_shape: ["rect", "circle", "banquette"],
      flow_execution_status: ["running", "completed", "failed", "cancelled"],
      flow_step_type: ["send_template", "wait", "condition", "add_tag"],
      flow_trigger_type: [
        "customer_inactive",
        "birthday",
        "after_visit",
        "event_starting",
        "tag_added",
      ],
      job_status: ["pending", "processing", "done", "failed"],
      marketing_task_category: ["eventos", "promociones", "impresiones"],
      marketing_task_kind: [
        "design",
        "shoot",
        "edit",
        "script",
        "ads",
        "publish",
        "print",
        "coordinate",
        "other",
      ],
      marketing_task_status: [
        "todo",
        "in_progress",
        "blocked",
        "done",
        "backlog",
        "waiting_feedback",
      ],
      meal_type: ["breakfast", "lunch", "tea_time", "dinner", "hub_event"],
      message_direction: ["inbound", "outbound"],
      message_status: ["queued", "sent", "delivered", "read", "failed"],
      points_rule_type: ["per_amount", "per_item"],
      punch_trigger_type: ["item", "category", "tag", "visit_window", "manual"],
      recipient_status: [
        "pending",
        "sending",
        "sent",
        "delivered",
        "read",
        "replied",
        "failed",
      ],
      redemption_status: ["pending", "delivered", "cancelled"],
      reservation_kind: ["normal", "birthday", "special"],
      reservation_origin: [
        "whatsapp",
        "instagram",
        "messenger",
        "in_person",
        "partner_referral",
        "web",
      ],
      salon_reservation_status: [
        "pending",
        "arrived",
        "seated",
        "closed",
        "no_show",
        "cancelled",
      ],
      salon_zone: ["planta_alta", "planta_baja", "event_floating"],
      service_alert: [
        "celiac",
        "allergy",
        "vegetarian",
        "vegan",
        "reduced_mobility",
        "baby_seat",
      ],
      session_event_type: [
        "session_opened",
        "guest_joined",
        "guest_registered",
        "bill_requested",
        "session_paid",
        "session_merged",
        "session_split",
        "session_abandoned",
        "session_moved",
        "party_size_changed",
        "alias_changed",
      ],
      session_status: ["open", "paid", "merged", "abandoned"],
      template_status: ["draft", "pending", "approved", "rejected", "disabled"],
      tenant_role: [
        "owner",
        "cashier",
        "waiter",
        "kitchen",
        "editor",
        "host",
        "accountant",
      ],
      ticket_status: [
        "pending",
        "accepted",
        "preparing",
        "ready",
        "served",
        "cancelled",
      ],
      tier_benefit_cadence: ["none", "birthday", "monthly"],
      visit_source: ["cashier", "import"],
    },
  },
} as const

export type BroadcastStatus = Database["public"]["Enums"]["broadcast_status"]
export type ChannelStatus = Database["public"]["Enums"]["channel_status"]
export type ChannelType = Database["public"]["Enums"]["channel_type"]
export type CustomerSource = Database["public"]["Enums"]["customer_source"]
export type FlowExecutionStatus = Database["public"]["Enums"]["flow_execution_status"]
export type FlowStepType = Database["public"]["Enums"]["flow_step_type"]
export type FlowTriggerType = Database["public"]["Enums"]["flow_trigger_type"]
export type JobStatus = Database["public"]["Enums"]["job_status"]
export type MealType = Database["public"]["Enums"]["meal_type"]
export type MessageDirection = Database["public"]["Enums"]["message_direction"]
export type MessageStatus = Database["public"]["Enums"]["message_status"]
export type PointsRuleType = Database["public"]["Enums"]["points_rule_type"]
export type PunchTriggerType = Database["public"]["Enums"]["punch_trigger_type"]
export type RecipientStatus = Database["public"]["Enums"]["recipient_status"]
export type RedemptionStatus = Database["public"]["Enums"]["redemption_status"]
export type ReservationKind = Database["public"]["Enums"]["reservation_kind"]
export type ReservationOrigin = Database["public"]["Enums"]["reservation_origin"]
export type SalonReservationStatus = Database["public"]["Enums"]["salon_reservation_status"]
export type SalonZone = Database["public"]["Enums"]["salon_zone"]
export type SessionEventType = Database["public"]["Enums"]["session_event_type"]
export type SessionStatus = Database["public"]["Enums"]["session_status"]
export type TemplateStatus = Database["public"]["Enums"]["template_status"]
export type TenantRole = Database["public"]["Enums"]["tenant_role"]
export type TicketStatus = Database["public"]["Enums"]["ticket_status"]
export type VisitSource = Database["public"]["Enums"]["visit_source"]
export type FloorElementKind = Database["public"]["Enums"]["floor_element_kind"]
export type FloorElementShape = Database["public"]["Enums"]["floor_element_shape"]
export type MarketingTaskCategory = Database["public"]["Enums"]["marketing_task_category"]
export type MarketingTaskKind = Database["public"]["Enums"]["marketing_task_kind"]
export type MarketingTaskStatus = Database["public"]["Enums"]["marketing_task_status"]
