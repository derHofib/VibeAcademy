import { SetMetadata } from '@nestjs/common';
import type { Role } from '@sn/shared';

export const IS_PUBLIC = 'sn:public';
export const ROLES = 'sn:roles';
export const ANY_ACCOUNT = 'sn:any-account';

/** Ohne Anmeldung erreichbar. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Angemeldetes Konto genügt, Mandant nicht nötig (z. B. Teilnehmerkonto „Meine Nachweise“). */
export const AnyAccount = () => SetMetadata(ANY_ACCOUNT, true);
/** Mindestens eine dieser Rollen im aktiven Mandanten. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
