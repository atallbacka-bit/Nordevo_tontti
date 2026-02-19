-- Create table for storing sales analysis data
CREATE TABLE IF NOT EXISTS sales_analysis_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data JSONB NOT NULL, -- Stores the full Excel row data
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    address_key TEXT NOT NULL, -- Used for duplicate checking (e.g. "Address_City")
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE sales_analysis_data ENABLE ROW LEVEL SECURITY;

-- Allow read/write access (since we use a unified service role or simple auth for this internal tool)
-- Adjust policy as needed for your specific auth setup. 
-- Assuming "allow all" for authenticated users specific to this internal tool context.
CREATE POLICY "Allow all access" ON sales_analysis_data FOR ALL USING (true) WITH CHECK (true);
