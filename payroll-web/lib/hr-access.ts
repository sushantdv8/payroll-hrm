import type {HrIdentity} from './hrm';
export const canHr=(actor:HrIdentity,module:string,action='view')=>!(actor.readonly&&!['view','reports'].includes(action))&&(actor.admin||(actor.permissions.modules[module]||actor.permissions.modules['*']||[]).includes(action));
