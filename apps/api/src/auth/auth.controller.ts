import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config';
import { displayName, email, password, ZodBody } from '../common/errors';
import { currentRequest } from '../common/request-context';
import { AnyAccount, Public } from './decorators';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, SESSION_COOKIE, SessionService } from './session.service';

const RegisterDozent = z.object({
  name: displayName,
  organisation: z.string().trim().min(2, 'Bitte den Namen der Organisation angeben').max(200),
  email,
  password,
});
const RegisterAccount = z.object({ name: displayName, email, password });
const Login = z.object({ email, password: z.string().min(1, 'Bitte Passwort eingeben').max(200) });
const SwitchTenant = z.object({ tenantId: z.uuid() });
const StepUp = z.object({
  password: z.string().min(1).max(200),
  purpose: z.string().regex(/^[a-z_]+:[0-9a-f-]{36}$/, 'Ungültiger Zweck'),
});
const SetPassword = z.object({ token: z.string().min(20).max(100), password });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setSession(res: Response, id: string) {
    res.cookie(SESSION_COOKIE, id, this.sessions.cookieOptions(this.config.NODE_ENV === 'production'));
  }

  /** Liefert das CSRF-Token (Cookie wird von der Middleware gesetzt). */
  @Public()
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response) {
    return { token: res.locals.csrf as string, header: 'x-csrf-token', cookie: CSRF_COOKIE };
  }

  @Public()
  @Post('register')
  async register(@Body(new ZodBody(RegisterDozent)) body: z.infer<typeof RegisterDozent>, @Res({ passthrough: true }) res: Response) {
    this.setSession(res, await this.auth.registerDozent(body));
    return { ok: true };
  }

  @Public()
  @Post('register-account')
  async registerAccount(@Body(new ZodBody(RegisterAccount)) body: z.infer<typeof RegisterAccount>, @Res({ passthrough: true }) res: Response) {
    this.setSession(res, await this.auth.registerAccount(body));
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodBody(Login)) body: z.infer<typeof Login>, @Res({ passthrough: true }) res: Response) {
    this.setSession(res, await this.auth.login(body));
    return { ok: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    const id = currentRequest()?.sessionId;
    if (id) await this.sessions.destroy(id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @AnyAccount()
  @Get('me')
  me() {
    return this.auth.me();
  }

  @AnyAccount()
  @Post('tenant')
  @HttpCode(200)
  async switchTenant(@Body(new ZodBody(SwitchTenant)) body: z.infer<typeof SwitchTenant>) {
    await this.auth.switchTenant(body.tenantId);
    return { ok: true };
  }

  @AnyAccount()
  @Post('step-up')
  @HttpCode(200)
  async stepUp(@Body(new ZodBody(StepUp)) body: z.infer<typeof StepUp>) {
    return { stepUpToken: await this.auth.stepUpWithPassword(body.password, body.purpose), expiresInSeconds: 300 };
  }

  @Public()
  @Post('password/set')
  @HttpCode(200)
  async setPassword(@Body(new ZodBody(SetPassword)) body: z.infer<typeof SetPassword>, @Res({ passthrough: true }) res: Response) {
    this.setSession(res, await this.auth.setPasswordWithToken(body.token, body.password));
    return { ok: true };
  }
}
