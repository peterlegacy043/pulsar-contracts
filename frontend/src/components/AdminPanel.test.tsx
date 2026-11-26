import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminPanel from './AdminPanel';

// Mock useAdminAuth hook
jest.mock('../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({
    adminAddress: 'GADMIN1234567890',
    isAdmin: true,
  }),
}));

describe('AdminPanel - merchant deactivation confirmation', () => {
  const mockFetchStats = jest.fn().mockResolvedValue({
    totalMerchants: 1,
    activeMerchants: 1,
    totalPayments: 0,
    totalVolume: '0',
  });

  const mockFetchMerchants = jest.fn().mockResolvedValue([
    {
      id: 'merchant-1',
      name: 'Test Merchant',
      address: 'GMERCHANT1234567890',
      active: true,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ]);

  const mockDeactivateMerchant = jest.fn().mockResolvedValue(undefined);
  const mockTriggerCleanup = jest.fn().mockResolvedValue(undefined);

  const renderPanel = () =>
    render(
      <AdminPanel
        adminAddress="GADMIN1234567890"
        fetchStats={mockFetchStats}
        fetchMerchants={mockFetchMerchants}
        deactivateMerchant={mockDeactivateMerchant}
        triggerCleanup={mockTriggerCleanup}
      />
    );

  const goToMerchantsAndLoad = async () => {
    const merchantsTab = screen.getByRole('button', { name: /merchants/i });
    fireEvent.click(merchantsTab);

    const loadButton = await screen.findByRole('button', { name: /load merchants/i });
    fireEvent.click(loadButton);

    await screen.findByText('Test Merchant');
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a confirmation dialog before deactivation and Cancel prevents the action', async () => {
    renderPanel();
    await goToMerchantsAndLoad();

    const deactivateButton = screen.getByRole('button', { name: /deactivate/i });
    fireEvent.click(deactivateButton);

    // Confirmation dialog should appear with merchant name and warning
    const dialogText = await screen.findByText(/deactivate test merchant\?/i);
    expect(dialogText).toBeInTheDocument();
    expect(screen.getByText(/this cannot be undone from this ui/i)).toBeInTheDocument();

    // Cancel should abort the action
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(mockDeactivateMerchant).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText(/deactivate test merchant\?/i)).not.toBeInTheDocument();
    });
  });

  it('invokes deactivateMerchant when Confirm is clicked', async () => {
    renderPanel();
    await goToMerchantsAndLoad();

    const deactivateButton = screen.getByRole('button', { name: /deactivate/i });
    fireEvent.click(deactivateButton);

    await screen.findByText(/deactivate test merchant\?/i);

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDeactivateMerchant).toHaveBeenCalledWith('merchant-1');
    });
  });
});