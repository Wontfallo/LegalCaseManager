"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useCaseCommunications, useCreateCommunication } from "@/hooks/useApi";
import { formatDateTime, getCommTypeLabel, truncate } from "@/lib/utils";
import type { CommType } from "@/types";
import {
  Box, Grid, Paper, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Stack, Chip, List, ListItem, ListItemButton, ListItemText, ListItemIcon,
  IconButton, CircularProgress, Divider
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import EmailIcon from "@mui/icons-material/Email";
import PhoneIcon from "@mui/icons-material/Phone";
import NoteIcon from "@mui/icons-material/Note";

interface Props {
  caseId: string;
}

export default function CommunicationsTab({ caseId }: Props) {
  const { data: communications, isLoading } = useCaseCommunications(caseId);
  const createComm = useCreateCommunication(caseId);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCommId, setSelectedCommId] = useState<string | null>(null);

  const [formData, setFormData] = useState<{
    comm_type: CommType;
    sender: string;
    recipient: string;
    subject: string;
    transcript_body: string;
  }>({
    comm_type: "NOTE",
    sender: "",
    recipient: "",
    subject: "",
    transcript_body: "",
  });

  const handleCreate = async () => {
    if (!formData.transcript_body.trim()) {
      toast.error("Content is required.");
      return;
    }
    try {
      await createComm.mutateAsync({
        case_id: caseId,
        comm_type: formData.comm_type,
        timestamp: new Date().toISOString(),
        sender: formData.sender || undefined,
        recipient: formData.recipient || undefined,
        subject: formData.subject || undefined,
        transcript_body: formData.transcript_body,
      });
      toast.success("Communication logged.");
      setShowCreate(false);
      setFormData({
        comm_type: "NOTE",
        sender: "",
        recipient: "",
        subject: "",
        transcript_body: "",
      });
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || "Failed to create communication."
      );
    }
  };

  const selectedComm = communications?.find((c) => c.id === selectedCommId);

  const getCommIcon = (type: string) => {
    switch (type) {
      case "EMAIL":
        return <EmailIcon color="primary" />;
      case "CALL":
        return <PhoneIcon color="success" />;
      default:
        return <NoteIcon color="warning" />;
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Communications List Panel */}
      <Box 
        sx={{ 
          width: selectedComm ? '50%' : '100%', 
          borderRight: selectedComm ? 1 : 0, 
          borderColor: 'divider',
          transition: 'width 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper'
        }}
      >
        <Box sx={{ p: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
              Communications
            </Typography>
            <Chip 
              label={communications?.length || 0} 
              size="small" 
              color="primary" 
              variant="outlined" 
              sx={{ fontWeight: 'bold' }} 
            />
          </Stack>
          <Button 
            variant="contained" 
            startIcon={<AddIcon />} 
            onClick={() => setShowCreate(true)}
            sx={{ fontWeight: 'bold', borderRadius: 2 }}
          >
            Log Activity
          </Button>
        </Box>

        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 4, bgcolor: 'background.default' }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : !communications || communications.length === 0 ? (
            <Typography align="center" color="text.secondary" sx={{ py: 8 }}>
              No communications logged yet.
            </Typography>
          ) : (
            <List spacing={2} component={Stack}>
              {communications.map((comm) => (
                <Paper 
                  key={comm.id} 
                  elevation={selectedCommId === comm.id ? 8 : 1}
                  sx={{ 
                    mb: 2,
                    border: 1,
                    borderColor: selectedCommId === comm.id ? 'primary.main' : 'divider',
                    bgcolor: selectedCommId === comm.id ? 'action.selected' : 'background.paper',
                    transition: 'all 0.2s',
                    overflow: 'hidden',
                    borderRadius: 2,
                    '&:hover': {
                      borderColor: 'primary.light',
                      bgcolor: 'action.hover'
                    }
                  }}
                >
                  <ListItemButton 
                    onClick={() => setSelectedCommId(selectedCommId === comm.id ? null : comm.id)}
                    sx={{ p: 3, alignItems: 'flex-start' }}
                  >
                    <ListItemIcon sx={{ mt: 0.5, minWidth: 48 }}>
                      {getCommIcon(comm.comm_type)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ mb: 1 }}>
                          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
                            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
                              {getCommTypeLabel(comm.comm_type)}
                            </Typography>
                            {comm.is_vectorized && (
                              <Chip size="small" label="Indexed" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }} />
                            )}
                          </Stack>
                          <Typography variant="body1" sx={{ fontWeight: 'bold', color: comm.subject ? 'text.primary' : 'text.disabled', fontStyle: comm.subject ? 'normal' : 'italic' }}>
                            {comm.subject || "No subject"}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box>
                          {comm.transcript_body && (
                            <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', mb: 2 }}>
                              {comm.transcript_body}
                            </Typography>
                          )}
                          <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
                            {comm.sender && (
                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                                From: {comm.sender}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                              {formatDateTime(comm.timestamp)}
                            </Typography>
                          </Stack>
                        </Box>
                      }
                      disableTypography
                    />
                  </ListItemButton>
                </Paper>
              ))}
            </List>
          )}
        </Box>
      </Box>

      {/* Detail Preview Panel */}
      {selectedComm && (
        <Box sx={{ width: '50%', flexShrink: 0, overflowY: 'auto', bgcolor: 'background.paper', p: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              Communication Detail
            </Typography>
            <IconButton onClick={() => setSelectedCommId(null)}>
              <CloseIcon />
            </IconButton>
          </Box>

          <Stack spacing={3}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>Type</Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{getCommTypeLabel(selectedComm.comm_type)}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>Timestamp</Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{formatDateTime(selectedComm.timestamp)}</Typography>
              </Grid>
              {selectedComm.subject && (
                <Grid size={{ xs: 12 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>Subject</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedComm.subject}</Typography>
                </Grid>
              )}
              {selectedComm.sender && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>From</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedComm.sender}</Typography>
                </Grid>
              )}
              {selectedComm.recipient && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>To</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedComm.recipient}</Typography>
                </Grid>
              )}
            </Grid>

            {selectedComm.transcript_body && (
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold', mb: 1, display: 'block' }}>Content</Typography>
                <Paper variant="outlined" sx={{ p: 3, maxHeight: '60vh', overflow: 'auto', bgcolor: 'background.default' }}>
                  <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.6 }}>
                    {selectedComm.transcript_body}
                  </Typography>
                </Paper>
              </Box>
            )}
          </Stack>
        </Box>
      )}

      {/* Create Dialog */}
      <Dialog 
        open={showCreate} 
        onClose={() => !createComm.isPending && setShowCreate(false)}
        maxWidth="sm"
        fullWidth
        sx={{ '& .MuiDialog-paper': { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>Add Communication Note</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              select
              label="Type"
              value={formData.comm_type}
              onChange={(e) => setFormData({ ...formData, comm_type: e.target.value as CommType })}
              fullWidth
              size="small"
            >
              <MenuItem value="NOTE">Note</MenuItem>
              <MenuItem value="EMAIL">Email</MenuItem>
              <MenuItem value="CALL">Phone Call</MenuItem>
            </TextField>
            
            <TextField
              label="Subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              fullWidth
              size="small"
              placeholder="Brief subject..."
            />

            <TextField
              label="Content"
              value={formData.transcript_body}
              onChange={(e) => setFormData({ ...formData, transcript_body: e.target.value })}
              fullWidth
              multiline
              rows={6}
              placeholder="Communication content or transcript..."
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, px: 3 }}>
          <Button onClick={() => setShowCreate(false)} color="inherit" disabled={createComm.isPending}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreate} 
            variant="contained" 
            disabled={createComm.isPending}
            sx={{ borderRadius: 2 }}
          >
            {createComm.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
