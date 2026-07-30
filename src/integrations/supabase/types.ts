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
      ads: {
        Row: {
          ad_id: string
          created_at: string
          id: string
          media_url: string | null
          name: string | null
          product_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          ad_id: string
          created_at?: string
          id?: string
          media_url?: string | null
          name?: string | null
          product_id?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          ad_id?: string
          created_at?: string
          id?: string
          media_url?: string | null
          name?: string | null
          product_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          ai_enabled: boolean
          autodetect_model: boolean
          created_at: string
          gemini_api_key: string | null
          id: string
          last_error: string | null
          model: string
          reply_delay_seconds: number
          system_instruction: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          ai_enabled?: boolean
          autodetect_model?: boolean
          created_at?: string
          gemini_api_key?: string | null
          id?: string
          last_error?: string | null
          model?: string
          reply_delay_seconds?: number
          system_instruction?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          ai_enabled?: boolean
          autodetect_model?: boolean
          created_at?: string
          gemini_api_key?: string | null
          id?: string
          last_error?: string | null
          model?: string
          reply_delay_seconds?: number
          system_instruction?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      app_messages: {
        Row: {
          body: string
          key: string
          title: string | null
          updated_at: string
        }
        Insert: {
          body?: string
          key: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          key?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity: string | null
          entity_id: string | null
          id: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      complaints: {
        Row: {
          body: string
          contact_id: string | null
          contact_name: string | null
          conversation_id: string | null
          created_at: string
          id: string
          message_id: string | null
          note: string | null
          phone: string
          reason: string
          severity: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body: string
          contact_id?: string | null
          contact_name?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          note?: string | null
          phone: string
          reason?: string
          severity?: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string
          contact_id?: string | null
          contact_name?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          note?: string | null
          phone?: string
          reason?: string
          severity?: string
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          city: string | null
          created_at: string
          id: string
          name: string | null
          notes: string | null
          phone: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          id?: string
          name?: string | null
          notes?: string | null
          phone: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          id?: string
          name?: string | null
          notes?: string | null
          phone?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_balances: {
        Row: {
          available: number
          consumed: number
          created_at: string
          expires_at: string | null
          id: string
          purchased: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          available?: number
          consumed?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          purchased?: number
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          available?: number
          consumed?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          purchased?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_balances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_labels: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          label_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          label_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          label_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_labels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_usage: {
        Row: {
          amount: number
          conversation_id: string | null
          created_at: string
          id: string
          reason: string
          user_id: string
          wamid: string | null
          workspace_id: string
        }
        Insert: {
          amount?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          reason?: string
          user_id: string
          wamid?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          reason?: string
          user_id?: string
          wamid?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_usage_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_usage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ad_id: string | null
          ad_media_url: string | null
          ai_paused: boolean
          contact_id: string
          created_at: string
          followups_paused: boolean
          id: string
          is_closed: boolean
          last_message: string | null
          last_message_at: string | null
          product_id: string | null
          sale_closed: boolean
          status: string
          unread_count: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          ad_id?: string | null
          ad_media_url?: string | null
          ai_paused?: boolean
          contact_id: string
          created_at?: string
          followups_paused?: boolean
          id?: string
          is_closed?: boolean
          last_message?: string | null
          last_message_at?: string | null
          product_id?: string | null
          sale_closed?: boolean
          status?: string
          unread_count?: number
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          ad_id?: string | null
          ad_media_url?: string | null
          ai_paused?: boolean
          contact_id?: string
          created_at?: string
          followups_paused?: boolean
          id?: string
          is_closed?: boolean
          last_message?: string | null
          last_message_at?: string | null
          product_id?: string | null
          sale_closed?: boolean
          status?: string
          unread_count?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_sends: {
        Row: {
          conversation_id: string
          id: string
          product_id: string | null
          sent_at: string
          step: number
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          product_id?: string | null
          sent_at?: string
          step?: number
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          product_id?: string | null
          sent_at?: string
          step?: number
          workspace_id?: string
        }
        Relationships: []
      }
      integration_logs: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          integration: string
          level: string
          message: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          integration: string
          level?: string
          message: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          integration?: string
          level?: string
          message?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          catalog_product_id: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["msg_direction"]
          error: string | null
          id: string
          media_type: string | null
          media_url: string | null
          sender: Database["public"]["Enums"]["msg_sender"]
          status: string
          transcript: string | null
          user_id: string
          wamid: string | null
          workspace_id: string
        }
        Insert: {
          body?: string | null
          catalog_product_id?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["msg_direction"]
          error?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          sender?: Database["public"]["Enums"]["msg_sender"]
          status?: string
          transcript?: string | null
          user_id: string
          wamid?: string | null
          workspace_id: string
        }
        Update: {
          body?: string | null
          catalog_product_id?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["msg_direction"]
          error?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          sender?: Database["public"]["Enums"]["msg_sender"]
          status?: string
          transcript?: string | null
          user_id?: string
          wamid?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          audience: string
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          audience?: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          audience?: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          price: number
          product_id: string | null
          quantity: number
          sku: string | null
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          price?: number
          product_id?: string | null
          quantity?: number
          sku?: string | null
          title: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          price?: number
          product_id?: string | null
          quantity?: number
          sku?: string | null
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          created_at: string
          id: string
          note: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_state"]
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_state"]
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_state"]
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          ad_id: string | null
          city: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          customer_name: string
          departamento: string | null
          district: string | null
          id: string
          observations: string | null
          order_number: string
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_state"]
          phone: string
          price: number
          product_id: string | null
          product_title: string | null
          quantity: number
          receipt_url: string | null
          reference: string | null
          sku: string | null
          status: Database["public"]["Enums"]["order_state"]
          street: string | null
          tags: string[]
          total: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          ad_id?: string | null
          city?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_name: string
          departamento?: string | null
          district?: string | null
          id?: string
          observations?: string | null
          order_number: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_state"]
          phone: string
          price?: number
          product_id?: string | null
          product_title?: string | null
          quantity?: number
          receipt_url?: string | null
          reference?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["order_state"]
          street?: string | null
          tags?: string[]
          total?: number
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          ad_id?: string | null
          city?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string
          departamento?: string | null
          district?: string | null
          id?: string
          observations?: string | null
          order_number?: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_state"]
          phone?: string
          price?: number
          product_id?: string | null
          product_title?: string | null
          quantity?: number
          receipt_url?: string | null
          reference?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["order_state"]
          street?: string | null
          tags?: string[]
          total?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          note: string | null
          order_id: string | null
          url: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          url: string
          user_id: string
          workspace_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          url?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_purchases: {
        Row: {
          admin_note: string | null
          amount: number
          approved_at: string | null
          conversations: number
          created_at: string
          expires_at: string | null
          id: string
          plan_id: string | null
          plan_name: string | null
          receipt_url: string | null
          status: Database["public"]["Enums"]["purchase_state"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          admin_note?: string | null
          amount?: number
          approved_at?: string | null
          conversations?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id?: string | null
          plan_name?: string | null
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["purchase_state"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          approved_at?: string | null
          conversations?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id?: string | null
          plan_name?: string | null
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["purchase_state"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_purchases_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_purchases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          benefits: string[]
          conversations: number
          created_at: string
          duration_days: number
          id: string
          is_active: boolean
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          benefits?: string[]
          conversations?: number
          created_at?: string
          duration_days?: number
          id?: string
          is_active?: boolean
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          benefits?: string[]
          conversations?: number
          created_at?: string
          duration_days?: number
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_followups: {
        Row: {
          created_at: string
          delay_minutes: number
          id: string
          is_active: boolean
          message: string
          product_id: string
          skip_if_purchased: boolean
          step: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          message: string
          product_id: string
          skip_if_purchased?: boolean
          step?: number
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          delay_minutes?: number
          id?: string
          is_active?: boolean
          message?: string
          product_id?: string
          skip_if_purchased?: boolean
          step?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_followups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_followups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_keywords: {
        Row: {
          created_at: string
          id: string
          keyword: string
          product_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          keyword: string
          product_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          keyword?: string
          product_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_keywords_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_keywords_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          media_type: string
          position: number
          product_id: string
          storage_path: string | null
          url: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_type: string
          position?: number
          product_id: string
          storage_path?: string | null
          url: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          media_type?: string
          position?: number
          product_id?: string
          storage_path?: string | null
          url?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          ai_instructions: string | null
          created_at: string
          created_by: string | null
          delivery_info: string | null
          description: string | null
          followup_enabled: boolean
          followup_message: string | null
          followup_minutes: number
          id: string
          is_active: boolean
          name: string
          no_repeat_template: boolean
          price: number
          promo_price: number | null
          sales_copy: string | null
          sku: string | null
          stock: number
          updated_at: string
          user_id: string
          variants: Json
          workspace_id: string
        }
        Insert: {
          ai_instructions?: string | null
          created_at?: string
          created_by?: string | null
          delivery_info?: string | null
          description?: string | null
          followup_enabled?: boolean
          followup_message?: string | null
          followup_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          no_repeat_template?: boolean
          price?: number
          promo_price?: number | null
          sales_copy?: string | null
          sku?: string | null
          stock?: number
          updated_at?: string
          user_id: string
          variants?: Json
          workspace_id: string
        }
        Update: {
          ai_instructions?: string | null
          created_at?: string
          created_by?: string | null
          delivery_info?: string | null
          description?: string | null
          followup_enabled?: boolean
          followup_message?: string | null
          followup_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          no_repeat_template?: boolean
          price?: number
          promo_price?: number | null
          sales_copy?: string | null
          sku?: string | null
          stock?: number
          updated_at?: string
          user_id?: string
          variants?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          status_message: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          status_message?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          status_message?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      training_entries: {
        Row: {
          category: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          keywords: string[]
          priority: number
          product_id: string | null
          schedule_from: string | null
          schedule_to: string | null
          scope: string
          title: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          priority?: number
          product_id?: string | null
          schedule_from?: string | null
          schedule_to?: string | null
          scope?: string
          title: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          priority?: number
          product_id?: string | null
          schedule_from?: string | null
          schedule_to?: string | null
          scope?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          apps_script_url: string | null
          business_name: string | null
          catalog_enabled: boolean
          created_at: string
          currency: string
          google_sheets_url: string | null
          id: string
          last_sheet_sync: string | null
          notify_numbers: string[]
          timezone: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          apps_script_url?: string | null
          business_name?: string | null
          catalog_enabled?: boolean
          created_at?: string
          currency?: string
          google_sheets_url?: string | null
          id?: string
          last_sheet_sync?: string | null
          notify_numbers?: string[]
          timezone?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          apps_script_url?: string | null
          business_name?: string | null
          catalog_enabled?: boolean
          created_at?: string
          currency?: string
          google_sheets_url?: string | null
          id?: string
          last_sheet_sync?: string | null
          notify_numbers?: string[]
          timezone?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_id: string
          id: string
          payload: Json | null
          processed: boolean
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id: string
          id?: string
          payload?: Json | null
          processed?: boolean
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string
          id?: string
          payload?: Json | null
          processed?: boolean
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_connections: {
        Row: {
          access_token: string | null
          app_id: string | null
          app_secret: string | null
          connected: boolean
          created_at: string
          display_phone: string | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          phone_number_id: string | null
          updated_at: string
          user_id: string
          verify_token: string | null
          waba_id: string | null
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          app_id?: string | null
          app_secret?: string | null
          connected?: boolean
          created_at?: string
          display_phone?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          phone_number_id?: string | null
          updated_at?: string
          user_id: string
          verify_token?: string | null
          waba_id?: string | null
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          app_id?: string | null
          app_secret?: string | null
          connected?: boolean
          created_at?: string
          display_phone?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          phone_number_id?: string | null
          updated_at?: string
          user_id?: string
          verify_token?: string | null
          waba_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_workspace_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_workspace_member: { Args: { _workspace_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "seller"
      msg_direction: "inbound" | "outbound"
      msg_sender: "customer" | "ai" | "agent" | "system"
      order_state:
        | "nuevo"
        | "confirmado"
        | "cargado"
        | "preparacion"
        | "enviado"
        | "entregado"
        | "cancelado"
      payment_state:
        | "pendiente"
        | "anticipado"
        | "pagado"
        | "contraentrega"
        | "rechazado"
      purchase_state: "pendiente" | "aprobado" | "rechazado"
      user_status:
        | "pending"
        | "approved"
        | "rejected"
        | "blocked"
        | "active"
        | "suspended"
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
      app_role: ["admin", "seller"],
      msg_direction: ["inbound", "outbound"],
      msg_sender: ["customer", "ai", "agent", "system"],
      order_state: [
        "nuevo",
        "confirmado",
        "cargado",
        "preparacion",
        "enviado",
        "entregado",
        "cancelado",
      ],
      payment_state: [
        "pendiente",
        "anticipado",
        "pagado",
        "contraentrega",
        "rechazado",
      ],
      purchase_state: ["pendiente", "aprobado", "rechazado"],
      user_status: [
        "pending",
        "approved",
        "rejected",
        "blocked",
        "active",
        "suspended",
      ],
    },
  },
} as const
