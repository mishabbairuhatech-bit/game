import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { UserRole } from '@empire/shared';
import {
  Authenticated,
  ClientIp,
  CurrentUser,
  RequestId,
  RequireRole,
  UserAgent,
} from '../common/decorators';
import {
  AdminService,
  AdminOverview,
  ConfigEntry,
  SystemStatus,
} from './admin.service';

class UpdateConfigDto {
  @ApiProperty({ description: 'New value, serialised as a string.' })
  @IsString()
  @MaxLength(2000)
  value!: string;
}

/**
 * Every route here requires at least MODERATOR, and the write routes require
 * ADMIN. RolesGuard compares by rank, so SUPER_ADMIN satisfies both.
 *
 * Every mutation writes an AuditLog row inside AdminService - that is a hard
 * requirement, not a convention: an unattributable balance or balance-affecting
 * config change is indistinguishable from an exploit after the fact.
 */
@ApiTags('admin')
@Authenticated()
@RequireRole(UserRole.MODERATOR)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Dashboard counters across users, world, economy and moderation.',
    description: 'Cached for 15 seconds.',
  })
  overview(): Promise<AdminOverview> {
    return this.admin.overview();
  }

  @Get('system')
  @ApiOperation({ summary: 'API, Postgres and Redis status plus enabled features.' })
  system(): Promise<SystemStatus> {
    return this.admin.system();
  }

  @Get('config')
  @ApiOperation({
    summary: 'Every runtime-tunable game value.',
    description:
      'Returns the stored value alongside the compiled default so the panel can ' +
      'show what has been overridden.',
  })
  listConfig(): Promise<ConfigEntry[]> {
    return this.admin.listConfig();
  }

  @RequireRole(UserRole.ADMIN)
  @Patch('config/:key')
  @ApiOperation({
    summary: 'Change one game configuration value.',
    description:
      'Type-checked against the key\'s declared type, applied across every API ' +
      'replica within the cache TTL, and recorded in the audit log.',
  })
  updateConfig(
    @Param('key') key: string,
    @Body() dto: UpdateConfigDto,
    @CurrentUser('id') adminId: string,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @RequestId() requestId: string | null,
  ): Promise<ConfigEntry> {
    return this.admin.updateConfig(key, dto.value, { id: adminId, ip, userAgent, requestId });
  }
}
