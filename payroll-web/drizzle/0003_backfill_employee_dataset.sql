-- Employees loaded by the earlier backup sample were stored before the dataset column existed,
-- so 0002 left them in 'manual'. Move them to their recorded source dataset.
UPDATE `employees` SET `dataset`=json_extract(`data`,'$.sourceDataset') WHERE `dataset`='manual' AND json_extract(`data`,'$.sourceDataset') IS NOT NULL AND json_extract(`data`,'$.sourceDataset') GLOB '[a-zA-Z0-9_-]*' AND NOT EXISTS (SELECT 1 FROM `employees` o WHERE o.`owner`=`employees`.`owner` AND o.`dataset`=json_extract(`employees`.`data`,'$.sourceDataset') AND o.`paycode`=`employees`.`paycode`);
