-- Run this query to check if the procedure exists:

SELECT object_name, object_type, status
FROM user_objects
WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V3';

-- If you get NO ROWS, then you need to run STEP 2 from 10_fix_trip_id_support.sql first!
-- If you get a row with status = 'VALID', then the procedure exists and we need to fix the endpoint code
-- If you get a row with status = 'INVALID', then there's a compilation error in the procedure
