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
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          customer_id: string
          error: string | null
          id: string
          message_id: string | null
          queued_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["recipient_status"]
        }
        Insert: {
          broadcast_id: string
          customer_id: string
          error?: string | null
          id?: string
          message_id?: string | null
          queued_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Update: {
          broadcast_id?: string
          customer_id?: string
          error?: string | null
          id?: string
          message_id?: string | null
          queued_at?: string | null
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
      conversations: {
        Row: {
          channel_id: string
          created_at: string
          customer_id: string | null
          external_user_id: string
          id: string
          last_message_at: string | null
          tenant_id: string
          unread_count: number
        }
        Insert: {
          channel_id: string
          created_at?: string
          customer_id?: string | null
          external_user_id: string
          id?: string
          last_message_at?: string | null
          tenant_id: string
          unread_count?: number
        }
        Update: {
          channel_id?: string
          created_at?: string
          customer_id?: string | null
          external_user_id?: string
          id?: string
          last_message_at?: string | null
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
          birthdate: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          email_opt_in_at: string | null
          first_name: string
          id: string
          last_name: string
          last_visit_at: string | null
          notes: string | null
          opt_in_at: string | null
          opt_in_ip: string | null
          opt_in_marketing: boolean
          phone: string
          points_balance: number
          qr_token: string
          qr_token_generated_at: string
          source: Database["public"]["Enums"]["customer_source"]
          tenant_id: string
          total_spent_cents: number
          total_visits: number
          updated_at: string
        }
        Insert: {
          birthdate?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          email_opt_in_at?: string | null
          first_name: string
          id?: string
          last_name: string
          last_visit_at?: string | null
          notes?: string | null
          opt_in_at?: string | null
          opt_in_ip?: string | null
          opt_in_marketing?: boolean
          phone: string
          points_balance?: number
          qr_token?: string
          qr_token_generated_at?: string
          source?: Database["public"]["Enums"]["customer_source"]
          tenant_id: string
          total_spent_cents?: number
          total_visits?: number
          updated_at?: string
        }
        Update: {
          birthdate?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          email_opt_in_at?: string | null
          first_name?: string
          id?: string
          last_name?: string
          last_visit_at?: string | null
          notes?: string | null
          opt_in_at?: string | null
          opt_in_ip?: string | null
          opt_in_marketing?: boolean
          phone?: string
          points_balance?: number
          qr_token?: string
          qr_token_generated_at?: string
          source?: Database["public"]["Enums"]["customer_source"]
          tenant_id?: string
          total_spent_cents?: number
          total_visits?: number
          updated_at?: string
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
      event_attendees: {
        Row: {
          checked_in_at: string | null
          checked_in_by: string | null
          created_at: string
          customer_id: string | null
          event_id: string
          guests_count: number
          id: string
          salon_reservation_id: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          tenant_id: string
          updated_at: string
          waitlist_position: number | null
        }
        Insert: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          customer_id?: string | null
          event_id: string
          guests_count?: number
          id?: string
          salon_reservation_id?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          tenant_id: string
          updated_at?: string
          waitlist_position?: number | null
        }
        Update: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          customer_id?: string | null
          event_id?: string
          guests_count?: number
          id?: string
          salon_reservation_id?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          tenant_id?: string
          updated_at?: string
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_salon_reservation_id_fkey"
            columns: ["salon_reservation_id"]
            isOneToOne: false
            referencedRelation: "salon_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "mv_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_churn_risk"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number | null
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string
          id: string
          name: string
          starts_at: string
          status: Database["public"]["Enums"]["event_status"]
          tenant_id: string
          updated_at: string
          waitlist_enabled: boolean
        }
        Insert: {
          capacity?: number | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at: string
          id?: string
          name: string
          starts_at: string
          status?: Database["public"]["Enums"]["event_status"]
          tenant_id: string
          updated_at?: string
          waitlist_enabled?: boolean
        }
        Update: {
          capacity?: number | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string
          id?: string
          name?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["event_status"]
          tenant_id?: string
          updated_at?: string
          waitlist_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plan_areas: {
        Row: {
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
      flow_executions: {
        Row: {
          completed_at: string | null
          context: Json
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
          created_at: string
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          position: number
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          parent_id?: string | null
          position?: number
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          parent_id?: string | null
          position?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_tenant_id_fkey"
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
          category_id: string
          created_at: string
          description: string | null
          featured: boolean
          id: string
          image_url: string | null
          name: string
          points_override: number | null
          position: number
          price_cents: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          name: string
          points_override?: number | null
          position?: number
          price_cents: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          name?: string
          points_override?: number | null
          position?: number
          price_cents?: number
          tenant_id?: string
          updated_at?: string
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
            foreignKeyName: "menu_items_tenant_id_fkey"
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
      physical_tables: {
        Row: {
          active: boolean
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
            foreignKeyName: "physical_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      reward_redemptions: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          notes: string | null
          points_spent: number
          redeemed_at: string
          redeemed_by: string | null
          reward_id: string
          status: Database["public"]["Enums"]["redemption_status"]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          notes?: string | null
          points_spent: number
          redeemed_at?: string
          redeemed_by?: string | null
          reward_id: string
          status?: Database["public"]["Enums"]["redemption_status"]
          tenant_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          notes?: string | null
          points_spent?: number
          redeemed_at?: string
          redeemed_by?: string | null
          reward_id?: string
          status?: Database["public"]["Enums"]["redemption_status"]
          tenant_id?: string
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
          cost_points: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          stock: number | null
          tenant_id: string
        }
        Insert: {
          active?: boolean
          cost_points: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          stock?: number | null
          tenant_id: string
        }
        Update: {
          active?: boolean
          cost_points?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          stock?: number | null
          tenant_id?: string
        }
        Relationships: [
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
          cake_count: number
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
          guest_name: string
          guest_phone: string | null
          hub_event_id: string | null
          id: string
          kind: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_time_local: string
          scheduled_event_id: string | null
          seated_at: string | null
          seated_by: string | null
          status: Database["public"]["Enums"]["salon_reservation_status"]
          tenant_id: string
          updated_at: string
          zone: Database["public"]["Enums"]["salon_zone"]
        }
        Insert: {
          actual_guests?: number | null
          arrived_at?: string | null
          arrived_by?: string | null
          assistant_manager_id?: string | null
          cake_count?: number
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
          estimated_guests: number
          guest_email?: string | null
          guest_name: string
          guest_phone?: string | null
          hub_event_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin?: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_time_local: string
          scheduled_event_id?: string | null
          seated_at?: string | null
          seated_by?: string | null
          status?: Database["public"]["Enums"]["salon_reservation_status"]
          tenant_id: string
          updated_at?: string
          zone: Database["public"]["Enums"]["salon_zone"]
        }
        Update: {
          actual_guests?: number | null
          arrived_at?: string | null
          arrived_by?: string | null
          assistant_manager_id?: string | null
          cake_count?: number
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
          estimated_guests?: number
          guest_email?: string | null
          guest_name?: string
          guest_phone?: string | null
          hub_event_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["reservation_kind"]
          meal_type?: Database["public"]["Enums"]["meal_type"]
          origin?: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id?: string
          reservation_date?: string
          reservation_time_local?: string
          scheduled_event_id?: string | null
          seated_at?: string | null
          seated_by?: string | null
          status?: Database["public"]["Enums"]["salon_reservation_status"]
          tenant_id?: string
          updated_at?: string
          zone?: Database["public"]["Enums"]["salon_zone"]
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
            foreignKeyName: "salon_reservations_hub_event_id_fkey"
            columns: ["hub_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
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
      scheduled_event_templates: {
        Row: {
          active: boolean
          color_hex: string
          consume_special_reservations: boolean
          created_at: string
          default_capacity: number | null
          default_meal_type: Database["public"]["Enums"]["meal_type"]
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
          capacity: number
          created_at: string
          ends_at_local: string | null
          event_date: string
          full_bonus_active: boolean
          id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          name_override: string | null
          notes: string | null
          starts_at_local: string
          template_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity: number
          created_at?: string
          ends_at_local?: string | null
          event_date: string
          full_bonus_active?: boolean
          id?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          name_override?: string | null
          notes?: string | null
          starts_at_local: string
          template_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          ends_at_local?: string | null
          event_date?: string
          full_bonus_active?: boolean
          id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          name_override?: string | null
          notes?: string | null
          starts_at_local?: string
          template_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
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
          created_at: string
          id: string
          merged_into: string | null
          opened_at: string
          opened_by: string | null
          paid_at: string | null
          party_size: number | null
          physical_table_id: string | null
          points_redeemed_cents: number
          points_redemptions: Json
          status: Database["public"]["Enums"]["session_status"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          abandoned_reason?: string | null
          alias?: string | null
          created_at?: string
          id?: string
          merged_into?: string | null
          opened_at?: string
          opened_by?: string | null
          paid_at?: string | null
          party_size?: number | null
          physical_table_id?: string | null
          points_redeemed_cents?: number
          points_redemptions?: Json
          status?: Database["public"]["Enums"]["session_status"]
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          abandoned_reason?: string | null
          alias?: string | null
          created_at?: string
          id?: string
          merged_into?: string | null
          opened_at?: string
          opened_by?: string | null
          paid_at?: string | null
          party_size?: number | null
          physical_table_id?: string | null
          points_redeemed_cents?: number
          points_redemptions?: Json
          status?: Database["public"]["Enums"]["session_status"]
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
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
            foreignKeyName: "table_sessions_tenant_id_fkey"
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
      tenants: {
        Row: {
          brand_accent: string | null
          created_at: string
          currency: string
          feature_flags: Json
          guest_idle_hours_to_rescan: number
          id: string
          kitchen_flow_enabled: boolean
          logo_url: string | null
          name: string
          points_redemption_enabled: boolean
          points_redemption_max_pct: number
          points_to_cents_rate: number
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
          created_at?: string
          currency?: string
          feature_flags?: Json
          guest_idle_hours_to_rescan?: number
          id?: string
          kitchen_flow_enabled?: boolean
          logo_url?: string | null
          name: string
          points_redemption_enabled?: boolean
          points_redemption_max_pct?: number
          points_to_cents_rate?: number
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
          created_at?: string
          currency?: string
          feature_flags?: Json
          guest_idle_hours_to_rescan?: number
          id?: string
          kitchen_flow_enabled?: boolean
          logo_url?: string | null
          name?: string
          points_redemption_enabled?: boolean
          points_redemption_max_pct?: number
          points_to_cents_rate?: number
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
          created_at: string
          id: string
          line_total_cents: number
          menu_item_id: string
          notes: string | null
          quantity: number
          ticket_id: string
          unit_price_cents: number
        }
        Insert: {
          assigned_to_guest_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          line_total_cents: number
          menu_item_id: string
          notes?: string | null
          quantity: number
          ticket_id: string
          unit_price_cents: number
        }
        Update: {
          assigned_to_guest_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          line_total_cents?: number
          menu_item_id?: string
          notes?: string | null
          quantity?: number
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
            foreignKeyName: "ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
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
          created_at: string
          created_by_guest_id: string | null
          created_by_user_id: string | null
          id: string
          idempotency_key: string | null
          prepared_at: string | null
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
          created_at?: string
          created_by_guest_id?: string | null
          created_by_user_id?: string | null
          id?: string
          idempotency_key?: string | null
          prepared_at?: string | null
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
          created_at?: string
          created_by_guest_id?: string | null
          created_by_user_id?: string | null
          id?: string
          idempotency_key?: string | null
          prepared_at?: string | null
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
          enabled: boolean
          headline: string
          reward_id: string | null
          subtext: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          headline?: string
          reward_id?: string | null
          subtext?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
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
      is_platform_admin: { Args: never; Returns: boolean }
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
      calculate_visit_points: {
        Args: { p_visit_id: string }
        Returns: {
          breakdown: Json
          delta: number
        }[]
      }
      cancel_event: { Args: { p_event_id: string }; Returns: undefined }
      cancel_event_attendance: {
        Args: { p_reservation_id: string }
        Returns: {
          promoted_id: string
        }[]
      }
      cancel_pending_ticket: {
        Args: { p_browser_token: string; p_ticket_id: string }
        Returns: Json
      }
      cancel_ticket_item: {
        Args: { p_reason: string; p_ticket_item_id: string }
        Returns: Json
      }
      check_in_event_attendance: {
        Args: { p_reservation_id: string }
        Returns: undefined
      }
      check_slug_available: { Args: { p_slug: string }; Returns: boolean }
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
      close_table: {
        Args: { p_customer_id: string; p_items: Json; p_notes?: string }
        Returns: {
          breakdown: Json
          points_awarded: number
          visit_id: string
        }[]
      }
      complete_job: { Args: { p_id: string }; Returns: undefined }
      create_event_attendance: {
        Args: { p_customer_id: string; p_event_id: string; p_guests?: number }
        Returns: {
          reservation_id: string
          status: Database["public"]["Enums"]["reservation_status"]
          waitlist_position: number
        }[]
      }
      create_tenant_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          created_at: string
          currency: string
          guest_idle_hours_to_rescan: number
          id: string
          kitchen_flow_enabled: boolean
          logo_url: string | null
          name: string
          points_redemption_enabled: boolean
          points_redemption_max_pct: number
          points_to_cents_rate: number
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
      event_lock_key: { Args: { p_event_id: string }; Returns: number }
      expire_punch_cards: { Args: never; Returns: Json }
      f_unaccent: { Args: { "": string }; Returns: string }
      fail_job: {
        Args: { p_error: string; p_id: string; p_recoverable?: boolean }
        Returns: undefined
      }
      find_user_id_by_email: { Args: { p_email: string }; Returns: string }
      finish_past_events: {
        Args: never
        Returns: {
          finished_events: number
          no_show_reservations: number
        }[]
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
      get_salon_occupancy: { Args: { p_tenant_id: string }; Returns: Json }
      get_session_state: {
        Args: { p_browser_token: string; p_qr_token: string }
        Returns: Json
      }
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
      join_session_as_guest: {
        Args: {
          p_browser_token: string
          p_display_name?: string
          p_qr_token: string
        }
        Returns: Json
      }
      link_salon_reservation_to_event: {
        Args: { p_event_id: string; p_reservation_id: string }
        Returns: {
          attendee_id: string
          status: Database["public"]["Enums"]["reservation_status"]
          waitlist_position: number
        }[]
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
      merge_sessions: {
        Args: { p_absorbed_ids: string[]; p_survivor_id: string }
        Returns: Json
      }
      move_session: {
        Args: { p_new_physical_table_id: string; p_session_id: string }
        Returns: Json
      }
      // STUB MANUAL (sin Docker para db:types): reemplazar al regenerar tipos
      // tras aplicar la migración 20260608200330_move_ticket_items.
      move_ticket_items: {
        Args: {
          p_idempotency_key?: string
          p_moves: Json
          p_source_session_id: string
          p_target_table_id: string
        }
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
      redeem_reward: {
        Args: { p_customer_id: string; p_reward_id: string }
        Returns: {
          balance_after: number
          redemption_id: string
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
      reorder_menu_categories: {
        Args: { p_ordered_ids: string[]; p_tenant_id: string }
        Returns: undefined
      }
      reorder_menu_items: {
        Args: { p_category_id: string; p_ordered_ids: string[] }
        Returns: undefined
      }
      request_bill: {
        Args: { p_browser_token: string; p_qr_token: string }
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
          p_first_name: string
          p_ip: string
          p_last_name: string
          p_link_slug: string
          p_opt_in: boolean
          p_phone: string
          p_user_agent: string
        }
        Returns: {
          customer_id: string
          was_new: boolean
        }[]
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
          cake_count: number
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
          guest_name: string
          guest_phone: string | null
          hub_event_id: string | null
          id: string
          kind: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_time_local: string
          scheduled_event_id: string | null
          seated_at: string | null
          seated_by: string | null
          status: Database["public"]["Enums"]["salon_reservation_status"]
          tenant_id: string
          updated_at: string
          zone: Database["public"]["Enums"]["salon_zone"]
        }
        SetofOptions: {
          from: "*"
          to: "salon_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unaccent: { Args: { "": string }; Returns: string }
      unlink_salon_reservation_from_event: {
        Args: { p_reservation_id: string }
        Returns: {
          promoted_id: string
        }[]
      }
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
          cake_count: number
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
          guest_name: string
          guest_phone: string | null
          hub_event_id: string | null
          id: string
          kind: Database["public"]["Enums"]["reservation_kind"]
          meal_type: Database["public"]["Enums"]["meal_type"]
          origin: Database["public"]["Enums"]["reservation_origin"]
          primary_manager_id: string
          reservation_date: string
          reservation_time_local: string
          scheduled_event_id: string | null
          seated_at: string | null
          seated_by: string | null
          status: Database["public"]["Enums"]["salon_reservation_status"]
          tenant_id: string
          updated_at: string
          zone: Database["public"]["Enums"]["salon_zone"]
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
      user_has_kitchen_role: { Args: { p_tenant_id: string }; Returns: boolean }
      user_role_in_tenant: {
        Args: { p_tenant: string }
        Returns: Database["public"]["Enums"]["tenant_role"]
      }
      user_tenant_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      broadcast_status:
        | "draft"
        | "scheduled"
        | "sending"
        | "sent"
        | "failed"
        | "cancelled"
      channel_status: "connected" | "disconnected" | "error"
      channel_type: "whatsapp" | "instagram"
      customer_source: "qr" | "manual" | "import"
      event_status: "draft" | "published" | "finished" | "cancelled"
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
      meal_type: "breakfast" | "lunch" | "tea_time" | "dinner" | "hub_event"
      message_direction: "inbound" | "outbound"
      message_status: "queued" | "sent" | "delivered" | "read" | "failed"
      points_rule_type: "per_amount" | "per_item"
      punch_trigger_type: "item" | "category" | "tag" | "visit_window"
      recipient_status:
        | "pending"
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
      reservation_status:
        | "confirmed"
        | "waitlist"
        | "cancelled"
        | "checked_in"
        | "no_show"
      salon_reservation_status:
        | "pending"
        | "arrived"
        | "seated"
        | "closed"
        | "no_show"
        | "cancelled"
      salon_zone: "planta_alta" | "planta_baja" | "event_floating"
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
      tenant_role: "owner" | "cashier" | "waiter" | "kitchen"
      ticket_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "served"
        | "cancelled"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      broadcast_status: [
        "draft",
        "scheduled",
        "sending",
        "sent",
        "failed",
        "cancelled",
      ],
      channel_status: ["connected", "disconnected", "error"],
      channel_type: ["whatsapp", "instagram"],
      customer_source: ["qr", "manual", "import"],
      event_status: ["draft", "published", "finished", "cancelled"],
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
      meal_type: ["breakfast", "lunch", "tea_time", "dinner", "hub_event"],
      message_direction: ["inbound", "outbound"],
      message_status: ["queued", "sent", "delivered", "read", "failed"],
      points_rule_type: ["per_amount", "per_item"],
      punch_trigger_type: ["item", "category", "tag", "visit_window"],
      recipient_status: [
        "pending",
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
      ],
      reservation_status: [
        "confirmed",
        "waitlist",
        "cancelled",
        "checked_in",
        "no_show",
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
      tenant_role: ["owner", "cashier", "waiter", "kitchen"],
      ticket_status: [
        "pending",
        "accepted",
        "preparing",
        "ready",
        "served",
        "cancelled",
      ],
      visit_source: ["cashier", "import"],
    },
  },
} as const

// ────────────────────────────────────────────────────────────
// Enum aliases (mantienen compatibilidad con imports existentes)
// ────────────────────────────────────────────────────────────
export type BroadcastStatus = Database["public"]["Enums"]["broadcast_status"]
export type ChannelStatus = Database["public"]["Enums"]["channel_status"]
export type ChannelType = Database["public"]["Enums"]["channel_type"]
export type CustomerSource = Database["public"]["Enums"]["customer_source"]
export type EventStatus = Database["public"]["Enums"]["event_status"]
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
export type ReservationStatus = Database["public"]["Enums"]["reservation_status"]
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
