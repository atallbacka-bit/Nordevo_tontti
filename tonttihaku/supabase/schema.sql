-- Tonttihaku PostgreSQL Schema for Supabase
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS plots (
    id text PRIMARY KEY,
    name text NOT NULL,
    zonings text,
    "buildingRight" integer DEFAULT 0,
    area integer DEFAULT 0,
    "priceEst" integer DEFAULT 0,
    "desc" text DEFAULT '',
    seller text DEFAULT '',
    status text DEFAULT 'Vapaa',
    deadline text DEFAULT '',
    address text DEFAULT '',
    kunta text DEFAULT 'Helsinki',
    kiinteistotunnus text DEFAULT '',
    lat double precision DEFAULT 0,
    lng double precision DEFAULT 0,
    "createdAt" text,
    "createdBy" text DEFAULT 'Tuntematon',
    "updatedAt" text DEFAULT '',
    "updatedBy" text DEFAULT '',
    notes text DEFAULT '[]',
    buyer text DEFAULT '',
    "finalPrice" integer DEFAULT 0,
    "soldDate" text DEFAULT '',
    "pricePerRight" integer DEFAULT 0,
    "offerPrice" integer DEFAULT 0,
    "offerDate" text DEFAULT '',
    "offerDesc" text DEFAULT '',
    "contactPerson" text DEFAULT '',
    "contactPhone" text DEFAULT '',
    "contactEmail" text DEFAULT '',
    contacts text DEFAULT '[]',
    "contactPersons" text DEFAULT '[]',
    priority integer DEFAULT 0,
    -- Wood construction potential: true = Puu, false = Betoni, null = unknown
    "Wood" boolean
);

-- Allow all operations (we handle auth at the API level with shared password)
ALTER TABLE plots ENABLE ROW LEVEL SECURITY;

-- Policy: allow all ops through service_role key (which bypasses RLS anyway)
-- For anon key access (not used directly, but just in case):
CREATE POLICY "Allow all for authenticated" ON plots FOR ALL USING (true) WITH CHECK (true);
