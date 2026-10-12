import type {ReportConfig} from './report-form';
import {combinedConfig,dailyConfig,monthlyAttendanceConfig,musterConfig,periodicConfig} from './attendance-reports';
import {fullFinalConfig} from './fnf-reports';
import {esiHalfYearlyConfig,esiMonthlyConfig} from './esi-reports';
import {pfEligibilityConfig,pfMonthlyConfig,pfYearlyConfig} from './pf-reports';
import {bankConfig,esiConfig,payslipConfig,pfConfig,salaryConfig} from './salary-reports';
import {comparisonConfig} from './comparison-report';
import {adultConfig,arrearConfig,bonusConfig,joinResignConfig,letterConfig,loanConfig,personalFileConfig} from './people-reports';

// Report screens by name used in lib/menu.ts ({kind:'report',report}).
export const reportConfigs:Record<string,ReportConfig>={
 muster:musterConfig,monthly:monthlyAttendanceConfig,daily:dailyConfig,combined:combinedConfig,periodic:periodicConfig,fullFinal:fullFinalConfig,
 salary:salaryConfig,comparison:comparisonConfig,bank:bankConfig,payslip:payslipConfig,pf:pfConfig,esi:esiConfig,esiMonthly:esiMonthlyConfig,esiHalfYearly:esiHalfYearlyConfig,
 pfMonthly:pfMonthlyConfig,pfYearly:pfYearlyConfig,pfEligibility:pfEligibilityConfig,
 personal:personalFileConfig,adult:adultConfig,joinResign:joinResignConfig,letter:letterConfig,arrear:arrearConfig,bonus:bonusConfig,loan:loanConfig,
};
