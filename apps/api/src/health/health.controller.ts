import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { LivenessResponse, ReadinessResponse } from '@empire/shared';
import { Public } from '../common/decorators';
import { RawResponse } from '../common/interceptors/response.interceptor';
import { HealthService } from './health.service';

/**
 * Two probes, deliberately different:
 *
 *   /api/health  liveness  - "is the process alive?" No dependency calls, so a
 *                            database blip never causes Docker to kill an
 *                            otherwise-healthy container.
 *   /api/ready   readiness - "can it serve traffic?" Verifies Postgres and
 *                            Redis and returns 503 when either is down, so a
 *                            load balancer can drain the instance.
 *
 * VERSION_NEUTRAL keeps them off the /v1 path: the container healthcheck URL
 * must not change when the API version bumps.
 *
 * NGINX additionally aliases the bare `/health` and `/ready` onto these for
 * ops tooling that expects root-level probes.
 */
@ApiTags('health')
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @RawResponse()
  @Get('health')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Liveness probe. Never touches a dependency.' })
  @ApiResponse({ status: 200, description: 'Process is alive.' })
  liveness(): LivenessResponse {
    return this.health.liveness();
  }

  @Public()
  @RawResponse()
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Readiness probe. Verifies Postgres and Redis.' })
  @ApiResponse({ status: 200, description: 'All dependencies reachable.' })
  @ApiResponse({ status: 503, description: 'At least one dependency is down.' })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    if (result.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
