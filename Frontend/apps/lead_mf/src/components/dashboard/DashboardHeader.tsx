import React from 'react';
import { Layers, UserPlus, Sparkles } from '@omniconnect/ui/icons';
import { Button, PageHeader } from '@omniconnect/ui';
import { TimeRangeFilterDropdown } from './TimeRangeFilterDropdown';
import { useLeadStore } from '../../store/useLeadStore';
import { useHostNavigate } from '../../navigation/HostNavigation';
import { canCreateLead } from '../../api/hostBridge';

/**
 * Lead Management dashboard banner.
 *
 * Now @omniconnect/ui's PageHeader, so it is literally the same banner the host renders on Audit Logs
 * and Approval Center rather than a near-copy. That removed, in one go: the hand-rolled gradient and
 * its two decorative circles, the glass icon tile, the title/pill/subtitle typography, a white CTA
 * with a JS-driven hover, and an injected `<style>` tag that duplicated the host's 768px hero
 * breakpoint by hand — PageHeader carries that breakpoint itself.
 */
export const DashboardHeader: React.FC = () => {
  const navigate = useHostNavigate();
  const userCanCreate = canCreateLead();

  return (
    <PageHeader
      icon={<Layers size={24} />}
      title="Lead Management Overview"
      pill={
        <>
          <Sparkles size={11} /> Live
        </>
      }
      subtitle="Real-time operational metrics, financing pipelines & regional distributions"
      actions={
        <>
          {userCanCreate && (
            <Button
              type="button"
              variant="onHeader"
              onClick={() => navigate('create-lead')}
              leadingIcon={<UserPlus size={15} />}
            >
              Create New Lead
            </Button>
          )}
          <TimeRangeFilterDropdown />
        </>
      }
    />
  );
};
