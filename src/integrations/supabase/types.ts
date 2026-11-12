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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      buffer_autopost: {
        Row: {
          channel_ids: string[]
          enabled: boolean
          last_result: string | null
          last_slot_key: string | null
          slots: string[]
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_ids?: string[]
          enabled?: boolean
          last_result?: string | null
          last_slot_key?: string | null
          slots?: string[]
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_ids?: string[]
          enabled?: boolean
          last_result?: string | null
          last_slot_key?: string | null
          slots?: string[]
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      instagram_accounts: {
        Row: {
          access_token: string
          connected_at: string
          ig_user_id: string
          user_id: string
          username: string
        }
        Insert: {
          access_token: string
          connected_at?: string
          ig_user_id: string
          user_id: string
          username?: string
        }
        Update: {
          access_token?: string
          connected_at?: string
          ig_user_id?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      posts: {
        Row: {
          caption: string
          created_at: string
          error: string | null
          id: string
          ig_container_id: string | null
          ig_media_id: string | null
          review_id: string
          scheduled_at: string
          status: string
          user_id: string
        }
        Insert: {
          caption?: string
          created_at?: string
          error?: string | null
          id?: string
          ig_container_id?: string | null
          ig_media_id?: string | null
          review_id: string
          scheduled_at?: string
          status?: string
          user_id?: string
        }
        Update: {
          caption?: string
          created_at?: string
          error?: string | null
          id?: string
          ig_container_id?: string | null
          ig_media_id?: string | null
          review_id?: string
          scheduled_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          features: string
          id: string
          image_url: string | null
          price: string | null
          research: string
          source: string
          title: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          features?: string
          id?: string
          image_url?: string | null
          price?: string | null
          research?: string
          source?: string
          title?: string
          url: string
          user_id?: string
        }
        Update: {
          created_at?: string
          features?: string
          id?: string
          image_url?: string | null
          price?: string | null
          research?: string
          source?: string
          title?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          caption: string
          created_at: string
          error: string | null
          hashtags: string
          hook: string
          id: string
          job_id: string | null
          language: string
          product_id: string
          scene_1: string
          scene_2: string
          script_mode: string
          stage: number
          status: string
          user_id: string
          video_path: string | null
          voiceover: string
        }
        Insert: {
          caption?: string
          created_at?: string
          error?: string | null
          hashtags?: string
          hook?: string
          id?: string
          job_id?: string | null
          language?: string
          product_id: string
          scene_1?: string
          scene_2?: string
          script_mode?: string
          stage?: number
          status?: string
          user_id?: string
          video_path?: string | null
          voiceover?: string
        }
        Update: {
          caption?: string
          created_at?: string
          error?: string | null
          hashtags?: string
          hook?: string
          id?: string
          job_id?: string | null
          language?: string
          product_id?: string
          scene_1?: string
          scene_2?: string
          script_mode?: string
          stage?: number
          status?: string
          user_id?: string
          video_path?: string | null
          voiceover?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_clips: {
        Row: {
          approved_at: string | null
          buffer_error: string | null
          buffer_posted_at: string | null
          caption: string
          created_at: string
          end_seconds: number
          id: string
          reason: string
          score: number
          source_id: string
          start_seconds: number
          title: string
          user_id: string
          video_path: string | null
          viral_review: Json | null
          voiceover: string | null
        }
        Insert: {
          approved_at?: string | null
          buffer_error?: string | null
          buffer_posted_at?: string | null
          caption?: string
          created_at?: string
          end_seconds: number
          id?: string
          reason?: string
          score?: number
          source_id: string
          start_seconds: number
          title: string
          user_id: string
          video_path?: string | null
          viral_review?: Json | null
          voiceover?: string | null
        }
        Update: {
          approved_at?: string | null
          buffer_error?: string | null
          buffer_posted_at?: string | null
          caption?: string
          created_at?: string
          end_seconds?: number
          id?: string
          reason?: string
          score?: number
          source_id?: string
          start_seconds?: number
          title?: string
          user_id?: string
          video_path?: string | null
          viral_review?: Json | null
          voiceover?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "studio_clips_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "studio_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_cloud_jobs: {
        Row: {
          clips: Json
          created_at: string
          error: string | null
          id: string
          music: string
          outro: boolean
          processing_token: string | null
          processing_until: string | null
          source_id: string
          status: string
          user_id: string
          worker_job_id: string
          worker_url: string
        }
        Insert: {
          clips?: Json
          created_at?: string
          error?: string | null
          id?: string
          music?: string
          outro?: boolean
          processing_token?: string | null
          processing_until?: string | null
          source_id: string
          status?: string
          user_id: string
          worker_job_id: string
          worker_url: string
        }
        Update: {
          clips?: Json
          created_at?: string
          error?: string | null
          id?: string
          music?: string
          outro?: boolean
          processing_token?: string | null
          processing_until?: string | null
          source_id?: string
          status?: string
          user_id?: string
          worker_job_id?: string
          worker_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "studio_cloud_jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "studio_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_credentials: {
        Row: {
          account_id: string
          account_name: string
          base_url: string | null
          encrypted_key: string
          kind: string
          model: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string
          account_name?: string
          base_url?: string | null
          encrypted_key: string
          kind: string
          model?: string
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          account_name?: string
          base_url?: string | null
          encrypted_key?: string
          kind?: string
          model?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      studio_posts: {
        Row: {
          caption: string
          clip_id: string
          comments: number | null
          container_id: string | null
          created_at: string
          error: string | null
          id: string
          likes: number | null
          media_id: string | null
          metrics_at: string | null
          metrics_error: string | null
          platform: string
          scheduled_at: string
          status: string
          user_id: string
          views: number | null
        }
        Insert: {
          caption?: string
          clip_id: string
          comments?: number | null
          container_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          likes?: number | null
          media_id?: string | null
          metrics_at?: string | null
          metrics_error?: string | null
          platform: string
          scheduled_at?: string
          status?: string
          user_id: string
          views?: number | null
        }
        Update: {
          caption?: string
          clip_id?: string
          comments?: number | null
          container_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          likes?: number | null
          media_id?: string | null
          metrics_at?: string | null
          metrics_error?: string | null
          platform?: string
          scheduled_at?: string
          status?: string
          user_id?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "studio_posts_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "studio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_sources: {
        Row: {
          author: string
          created_at: string
          duration: number | null
          id: string
          thumbnail_url: string | null
          title: string
          transcript: Json
          transcript_status: string
          url: string
          user_id: string
          youtube_id: string
        }
        Insert: {
          author?: string
          created_at?: string
          duration?: number | null
          id?: string
          thumbnail_url?: string | null
          title: string
          transcript?: Json
          transcript_status?: string
          url: string
          user_id: string
          youtube_id: string
        }
        Update: {
          author?: string
          created_at?: string
          duration?: number | null
          id?: string
          thumbnail_url?: string | null
          title?: string
          transcript?: Json
          transcript_status?: string
          url?: string
          user_id?: string
          youtube_id?: string
        }
        Relationships: []
      }
      youtube_connections: {
        Row: {
          channel_id: string
          channel_name: string
          encrypted_tokens: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          channel_name: string
          encrypted_tokens: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          channel_name?: string
          encrypted_tokens?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      youtube_oauth_states: {
        Row: {
          expires_at: string
          redirect_uri: string
          state_hash: string
          user_id: string
        }
        Insert: {
          expires_at: string
          redirect_uri: string
          state_hash: string
          user_id: string
        }
        Update: {
          expires_at?: string
          redirect_uri?: string
          state_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      youtube_posts: {
        Row: {
          clip_id: string
          comments: number | null
          created_at: string
          description: string
          error: string | null
          id: string
          likes: number | null
          media_id: string | null
          metrics_at: string | null
          metrics_error: string | null
          privacy: string
          scheduled_at: string | null
          status: string
          tags: string[]
          title: string
          user_id: string
          views: number | null
        }
        Insert: {
          clip_id: string
          comments?: number | null
          created_at?: string
          description?: string
          error?: string | null
          id?: string
          likes?: number | null
          media_id?: string | null
          metrics_at?: string | null
          metrics_error?: string | null
          privacy?: string
          scheduled_at?: string | null
          status?: string
          tags?: string[]
          title: string
          user_id: string
          views?: number | null
        }
        Update: {
          clip_id?: string
          comments?: number | null
          created_at?: string
          description?: string
          error?: string | null
          id?: string
          likes?: number | null
          media_id?: string | null
          metrics_at?: string | null
          metrics_error?: string | null
          privacy?: string
          scheduled_at?: string | null
          status?: string
          tags?: string[]
          title?: string
          user_id?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_posts_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "studio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_cloud_job: {
        Args: { _job_id: string; _owner_id: string; _token: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
